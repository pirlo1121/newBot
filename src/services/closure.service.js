import { closureReportText, computeClosure, percentOf } from '../domain/closure.js';
import { closureTriggerDate, nextPeriod, periodRange } from '../domain/dates.js';
import { formatCop } from '../domain/money.js';
import * as closuresRepo from '../repositories/closures.repository.js';
import { totalsByCategory } from '../repositories/expenses.repository.js';
import { sumPaidInstances } from '../repositories/fixedExpenses.repository.js';
import { sumIncomes } from '../repositories/incomes.repository.js';
import { insertNotification } from '../repositories/notifications.repository.js';
import { findPeriod, listOpenPeriodsBefore, markPeriodClosed } from '../repositories/periods.repository.js';
import { addToSavings, getSavings, insertSavingsMovement } from '../repositories/savings.repository.js';
import { salaryAt } from '../repositories/salary.repository.js';
import { getSettings } from '../repositories/settings.repository.js';
import { transaction } from '../db/transaction.js';
import { activePeriod, nowIso, today } from './context.js';
import { applyCurrentLimit } from './limits.service.js';
import { currentPayDay, ensurePeriod, generateInstances } from './periods.service.js';

/** Lee los totales de un periodo y aplica el cálculo puro (§8.6 pasos 2–6). */
export function previewClosure(ctx, userId, period) {
  const salary = salaryAt(ctx.db, userId, periodRange(period).end);
  const closure = computeClosure({
    salaryCents: salary?.amount_cents ?? 0,
    extraIncomeCents: sumIncomes(ctx.db, userId, period),
    fixedPaidCents: sumPaidInstances(ctx.db, userId, period),
    categoryTotals: totalsByCategory(ctx.db, userId, period)
  });
  return { closure, salaryMissing: !salary };
}

/** RN-16: crea o actualiza el mes siguiente con facturas y límite vigente. */
function prepareNextPeriod(ctx, userId, period) {
  const existed = Boolean(findPeriod(ctx.db, userId, period));
  ensurePeriod(ctx, userId, period);
  if (existed) {
    generateInstances(ctx, userId, period);
    const limit = getSettings(ctx.db, userId)?.monthly_limit_cents ?? null;
    if (limit) applyCurrentLimit(ctx, userId, period, limit);
  }
}

/**
 * Cierra un periodo en una sola transacción (§8.6). Idempotente: si ya está
 * cerrado o ya tiene resumen, no hace nada y devuelve null.
 */
export function closePeriod(ctx, userId, period) {
  return transaction(ctx.db, () => {
    const row = findPeriod(ctx.db, userId, period);
    if (!row || row.status !== 'open') return null;

    const closedAt = nowIso(ctx);
    if (closuresRepo.findClosure(ctx.db, userId, period)) {
      markPeriodClosed(ctx.db, row.id, closedAt);
      return null;
    }

    const { closure, salaryMissing } = previewClosure(ctx, userId, period);
    const saved = closuresRepo.insertClosure(ctx.db, {
      userId,
      period,
      ...closure,
      closedAt
    });
    for (const item of closure.breakdown) {
      closuresRepo.insertCategoryTotal(ctx.db, saved.id, item.category, item.total_cents);
    }

    let savings = getSavings(ctx.db, userId);
    if (closure.savedCents > 0) {
      savings = addToSavings(ctx.db, userId, closure.savedCents, closedAt);
      insertSavingsMovement(ctx.db, {
        userId,
        amountCents: closure.savedCents,
        type: 'cierre',
        period,
        closureId: saved.id,
        nowIso: closedAt
      });
    }

    markPeriodClosed(ctx.db, row.id, closedAt);
    prepareNextPeriod(ctx, userId, nextPeriod(period));

    const savingsBalance = savings?.balance_cents ?? 0;
    const text = closureReportText({ period, closure, savingsBalanceCents: savingsBalance, salaryMissing });
    insertNotification(ctx.db, {
      userId,
      type: 'cierre_mensual',
      period,
      payload: { closure_id: saved.id, saved_cents: closure.savedCents },
      text
    });

    return presentClosure(ctx, saved);
  });
}

/** Periodos abiertos anteriores al activo cuyo disparador ya llegó, en orden. */
function duePeriods(ctx, userId) {
  const day = today(ctx);
  const payDay = currentPayDay(ctx, userId);
  return listOpenPeriodsBefore(ctx.db, userId, activePeriod(ctx)).filter(
    (row) => day >= closureTriggerDate(row.period, payDay)
  );
}

/**
 * Procesa todos los cierres vencidos en orden (RN-12). Cada cierre crea el
 * mes siguiente, que puede quedar a su vez vencido si el proceso estuvo apagado.
 */
export function ensureClosures(ctx, userId, { dryRun = false } = {}) {
  if (dryRun) {
    return duePeriods(ctx, userId).map((row) => {
      const { closure, salaryMissing } = previewClosure(ctx, userId, row.period);
      return { period: row.period, dry_run: true, salary_missing: salaryMissing, ...presentComputed(closure) };
    });
  }

  const closed = [];
  for (let guard = 0; guard < 240; guard += 1) {
    const [next] = duePeriods(ctx, userId);
    if (!next) break;
    const result = closePeriod(ctx, userId, next.period);
    if (result) closed.push(result);
  }
  return closed;
}

function presentComputed(c) {
  return {
    salary_cents: c.salaryCents,
    extra_income_cents: c.extraIncomeCents,
    fixed_paid_cents: c.fixedPaidCents,
    extra_expense_cents: c.extraExpenseCents,
    balance_cents: c.balanceCents,
    saved_cents: c.savedCents,
    deficit_cents: c.deficitCents,
    top_category: c.topCategory,
    bottom_category: c.bottomCategory
  };
}

export function presentClosure(ctx, row) {
  const categories = closuresRepo.categoryTotalsOf(ctx.db, row.id).map((item) => ({
    category: item.category,
    total_cents: item.total_cents,
    total: formatCop(item.total_cents),
    percent: percentOf(item.total_cents, row.extra_expense_cents)
  }));
  return {
    id: row.id,
    period: row.period,
    salary_cents: row.salary_cents,
    extra_income_cents: row.extra_income_cents,
    income_cents: row.salary_cents + row.extra_income_cents,
    fixed_paid_cents: row.fixed_paid_cents,
    extra_expense_cents: row.extra_expense_cents,
    balance_cents: row.balance_cents,
    saved_cents: row.saved_cents,
    deficit_cents: row.deficit_cents,
    top_category: row.top_category,
    bottom_category: row.bottom_category,
    salary_missing: row.salary_cents === 0,
    categories,
    closed_at: row.closed_at,
    formatted: {
      salary: formatCop(row.salary_cents),
      extra_income: formatCop(row.extra_income_cents),
      income: formatCop(row.salary_cents + row.extra_income_cents),
      fixed_paid: formatCop(row.fixed_paid_cents),
      extra_expenses: formatCop(row.extra_expense_cents),
      balance: formatCop(row.balance_cents),
      saved: formatCop(row.saved_cents),
      deficit: formatCop(row.deficit_cents)
    }
  };
}

export function getClosure(ctx, userId, period) {
  const row = closuresRepo.findClosure(ctx.db, userId, period);
  return row ? presentClosure(ctx, row) : null;
}

export function getLatestClosure(ctx, userId) {
  const row = closuresRepo.latestClosure(ctx.db, userId);
  return row ? presentClosure(ctx, row) : null;
}

export const listClosures = (ctx, userId, limit) =>
  closuresRepo.listClosures(ctx.db, userId, limit).map((row) => presentClosure(ctx, row));

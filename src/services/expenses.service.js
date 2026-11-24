import { CATEGORIES, UNCATEGORIZED } from '../domain/categories.js';
import { percentOf } from '../domain/closure.js';
import { addDays, isValidDate, periodOf } from '../domain/dates.js';
import { formatCop } from '../domain/money.js';
import { notFound, validationError } from '../errors.js';
import * as repo from '../repositories/expenses.repository.js';
import { transaction } from '../db/transaction.js';
import { nowIso, today } from './context.js';
import { evaluateAlerts, getLimitStatus } from './limits.service.js';
import { assertWritablePeriod } from './periods.service.js';
import { presentExpense } from './presenters.js';

function checkDate(ctx, date) {
  if (!isValidDate(date)) throw validationError('La fecha debe tener el formato YYYY-MM-DD.');
  if (date > today(ctx)) throw validationError('No se permiten gastos con fecha futura.');
  return date;
}

function withAlerts(ctx, userId, period, payload) {
  const alerts = evaluateAlerts(ctx, userId, period);
  return { ...payload, alerts, limit: getLimitStatus(ctx, userId, period) };
}

/** RN-07: categoría opcional, fecha por defecto hoy y sin fechas futuras. */
export function createExpense(ctx, userId, { name, amountCents, category, date }) {
  const day = checkDate(ctx, date ?? today(ctx));
  const period = periodOf(day);
  return transaction(ctx.db, () => {
    assertWritablePeriod(ctx, userId, period);
    const row = repo.insertExpense(ctx.db, {
      userId,
      name,
      amountCents,
      category: category ?? null,
      date: day,
      period
    });
    return withAlerts(ctx, userId, period, { expense: presentExpense(row) });
  });
}

export function updateExpense(ctx, userId, id, patch) {
  return transaction(ctx.db, () => {
    const current = repo.findExpense(ctx.db, userId, id);
    if (!current) throw notFound('No encontré ese gasto.');
    assertWritablePeriod(ctx, userId, current.period);

    const date = patch.date !== undefined ? checkDate(ctx, patch.date) : current.date;
    const period = periodOf(date);
    if (period !== current.period) assertWritablePeriod(ctx, userId, period);

    const row = repo.updateExpense(ctx.db, {
      id,
      name: patch.name ?? current.name,
      amountCents: patch.amountCents ?? current.amount_cents,
      category: patch.category !== undefined ? patch.category : current.category,
      date,
      period,
      nowIso: nowIso(ctx)
    });
    if (period !== current.period) evaluateAlerts(ctx, userId, current.period);
    return withAlerts(ctx, userId, period, { expense: presentExpense(row) });
  });
}

export function deleteExpense(ctx, userId, id) {
  return transaction(ctx.db, () => {
    const current = repo.findExpense(ctx.db, userId, id);
    if (!current) throw notFound('No encontré ese gasto.');
    assertWritablePeriod(ctx, userId, current.period);
    repo.deleteExpense(ctx.db, id);
    return withAlerts(ctx, userId, current.period, {
      deleted: true,
      expense: presentExpense(current)
    });
  });
}

export function listExpenses(ctx, userId, filters, paging) {
  const { items, count, totalCents } = repo.listExpenses(ctx.db, userId, filters, paging);
  return {
    filters,
    items: items.map(presentExpense),
    count,
    total_cents: totalCents,
    formatted: { total: formatCop(totalCents) }
  };
}

export function recentExpenses(ctx, userId, limit) {
  return { items: repo.recentExpenses(ctx.db, userId, limit).map(presentExpense) };
}

/** Hoy y los `days` días anteriores, con subtotal por día (incluye días en cero). */
export function expensesByDay(ctx, userId, days) {
  const to = today(ctx);
  const from = addDays(to, -days);
  const rows = repo.expensesBetween(ctx.db, userId, from, to);

  const result = [];
  for (let offset = 0; offset <= days; offset += 1) {
    const date = addDays(to, -offset);
    const items = rows.filter((row) => row.date === date).map(presentExpense);
    const subtotal = items.reduce((sum, item) => sum + item.amount_cents, 0);
    result.push({ date, items, subtotal_cents: subtotal, subtotal: formatCop(subtotal) });
  }
  const total = result.reduce((sum, day) => sum + day.subtotal_cents, 0);
  return { from, to, days: result, total_cents: total, formatted: { total: formatCop(total) } };
}

export function expensesByCategory(ctx, userId, period) {
  const rows = repo.totalsByCategory(ctx.db, userId, period);
  const total = rows.reduce((sum, row) => sum + row.total_cents, 0);
  return {
    period,
    categories: rows.map((row) => ({
      category: row.category,
      count: row.count,
      total_cents: row.total_cents,
      total: formatCop(row.total_cents),
      percent: percentOf(row.total_cents, total)
    })),
    total_cents: total,
    formatted: { total: formatCop(total) }
  };
}

export const VALID_CATEGORY_FILTERS = [...CATEGORIES, UNCATEGORIZED];

import { clampDay, closureTriggerDate, periodRange } from '../domain/dates.js';
import { periodClosed, validationError } from '../errors.js';
import { insertInstance, listTemplates } from '../repositories/fixedExpenses.repository.js';
import { findPeriod, insertPeriod } from '../repositories/periods.repository.js';
import { salaryAt } from '../repositories/salary.repository.js';
import { getSettings } from '../repositories/settings.repository.js';
import { transaction } from '../db/transaction.js';
import { activePeriod, today } from './context.js';

/** Día de pago del salario vigente hoy (1 si no hay salario). */
export function currentPayDay(ctx, userId) {
  return salaryAt(ctx.db, userId, today(ctx))?.pay_day ?? 1;
}

/** Salario vigente para un periodo: última fila con effective_from <= fin de mes. */
export function salaryForPeriod(ctx, userId, period) {
  return salaryAt(ctx.db, userId, periodRange(period).end);
}

/** Crea las facturas pendientes del periodo para las plantillas activas. */
export function generateInstances(ctx, userId, period) {
  const created = [];
  for (const template of listTemplates(ctx.db, userId)) {
    const row = insertInstance(ctx.db, {
      userId,
      templateId: template.id,
      period,
      name: template.name,
      amountCents: template.amount_cents,
      dueDate: clampDay(period, template.due_day)
    });
    if (row) created.push(row);
  }
  return created;
}

/**
 * Asegura la fila del periodo. Si se crea, copia el límite vigente y,
 * salvo `withInstances: false`, genera sus facturas pendientes.
 */
export function ensurePeriod(ctx, userId, period, { withInstances = true } = {}) {
  return transaction(ctx.db, () => {
    const existing = findPeriod(ctx.db, userId, period);
    if (existing) return existing;
    const limit = getSettings(ctx.db, userId)?.monthly_limit_cents ?? null;
    const row = insertPeriod(ctx.db, userId, period, limit) ?? findPeriod(ctx.db, userId, period);
    if (withInstances) generateInstances(ctx, userId, period);
    return row;
  });
}

/**
 * Valida que se pueda escribir en el periodo (RN-17) y devuelve su fila.
 * - Cerrado → 409 PERIOD_CLOSED.
 * - Futuro → 400.
 * - Anterior sin fila: solo si su cierre aún no se disparó.
 */
export function assertWritablePeriod(ctx, userId, period) {
  const row = findPeriod(ctx.db, userId, period);
  if (row) {
    if (row.status === 'closed') throw periodClosed(period);
    return row;
  }

  const active = activePeriod(ctx);
  if (period > active) {
    throw validationError('No se pueden registrar movimientos en meses futuros.');
  }
  if (period === active) return ensurePeriod(ctx, userId, period);

  const trigger = closureTriggerDate(period, currentPayDay(ctx, userId));
  if (today(ctx) >= trigger) throw periodClosed(period);
  return ensurePeriod(ctx, userId, period, { withInstances: false });
}

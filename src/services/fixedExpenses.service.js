import { clampDay, isValidDate } from '../domain/dates.js';
import { alreadyPaid, notFound, periodClosed, validationError } from '../errors.js';
import * as repo from '../repositories/fixedExpenses.repository.js';
import { findPeriod } from '../repositories/periods.repository.js';
import { transaction } from '../db/transaction.js';
import { getBalance } from './balance.service.js';
import { activePeriod, nowIso, today } from './context.js';
import { ensurePeriod } from './periods.service.js';
import { presentInstance, presentTemplate } from './presenters.js';

export const listTemplates = (ctx, userId) => repo.listTemplates(ctx.db, userId).map(presentTemplate);

/** Crea la plantilla y la factura pendiente del periodo activo (RN-04). */
export function createTemplate(ctx, userId, { name, amountCents, dueDay }) {
  return transaction(ctx.db, () => {
    const period = activePeriod(ctx);
    ensurePeriod(ctx, userId, period);
    const template = repo.insertTemplate(ctx.db, { userId, name, amountCents, dueDay });
    repo.insertInstance(ctx.db, {
      userId,
      templateId: template.id,
      period,
      name,
      amountCents,
      dueDate: clampDay(period, dueDay)
    });
    const instance = repo.findPendingInstanceForTemplate(ctx.db, template.id, period);
    return {
      template: presentTemplate(template),
      instance: instance ? presentInstance(instance, today(ctx)) : null
    };
  });
}

/** RN-05: propaga al periodo activo solo si su factura sigue pendiente. */
export function updateTemplate(ctx, userId, id, patch) {
  return transaction(ctx.db, () => {
    const current = repo.findTemplate(ctx.db, userId, id);
    if (!current) throw notFound('No encontré ese gasto fijo.');

    const template = repo.updateTemplate(ctx.db, {
      id,
      name: patch.name ?? current.name,
      amountCents: patch.amountCents ?? current.amount_cents,
      dueDay: patch.dueDay ?? current.due_day,
      nowIso: nowIso(ctx)
    });

    const period = activePeriod(ctx);
    const pending = repo.findPendingInstanceForTemplate(ctx.db, id, period);
    if (pending) {
      repo.updateInstance(ctx.db, {
        id: pending.id,
        name: template.name,
        amountCents: template.amount_cents,
        dueDate: clampDay(period, template.due_day)
      });
    }
    return { template: presentTemplate(template), active_instance_updated: Boolean(pending) };
  });
}

/** Borra la plantilla y sus pendientes; las pagadas quedan con fixed_expense_id = NULL. */
export function deleteTemplate(ctx, userId, id) {
  return transaction(ctx.db, () => {
    const current = repo.findTemplate(ctx.db, userId, id);
    if (!current) throw notFound('No encontré ese gasto fijo.');
    const removed = repo.deletePendingInstancesOfTemplate(ctx.db, userId, id).changes;
    repo.deleteTemplate(ctx.db, id);
    return { deleted: true, template: presentTemplate(current), pending_instances_removed: removed };
  });
}

export function listInstances(ctx, userId, { period, status }) {
  const day = today(ctx);
  const items = repo.listInstances(ctx.db, userId, period, status).map((row) => presentInstance(row, day));
  return { period, status, items, count: items.length };
}

/** RN-06: marca la factura pagada; un mismo mes no se paga dos veces. */
export function payInstance(ctx, userId, id, { paidAt } = {}) {
  return transaction(ctx.db, () => {
    const instance = repo.findInstance(ctx.db, userId, id);
    if (!instance) throw notFound('No encontré esa factura.');
    if (findPeriod(ctx.db, userId, instance.period)?.status === 'closed') {
      throw periodClosed(instance.period);
    }
    if (instance.paid === 1) throw alreadyPaid();

    const day = today(ctx);
    const date = paidAt ?? day;
    if (!isValidDate(date)) throw validationError('La fecha de pago debe tener el formato YYYY-MM-DD.');
    if (date > day) throw validationError('La fecha de pago no puede ser futura.');

    repo.markInstancePaid(ctx.db, id, date);
    const updated = repo.findInstance(ctx.db, userId, id);
    return {
      paid: true,
      instance: presentInstance(updated, day),
      balance: getBalance(ctx, userId, instance.period)
    };
  });
}

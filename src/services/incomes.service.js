import { isValidDate, periodOf } from '../domain/dates.js';
import { notFound, validationError } from '../errors.js';
import * as repo from '../repositories/incomes.repository.js';
import { transaction } from '../db/transaction.js';
import { nowIso, today } from './context.js';
import { assertWritablePeriod } from './periods.service.js';
import { presentIncome } from './presenters.js';

function checkDate(date) {
  if (!isValidDate(date)) throw validationError('La fecha debe tener el formato YYYY-MM-DD.');
  return date;
}

export function createIncome(ctx, userId, { description, amountCents, date }) {
  const day = checkDate(date ?? today(ctx));
  const period = periodOf(day);
  return transaction(ctx.db, () => {
    assertWritablePeriod(ctx, userId, period);
    return presentIncome(repo.insertIncome(ctx.db, { userId, description, amountCents, date: day, period }));
  });
}

export function listIncomes(ctx, userId, { period, limit, offset }) {
  const items = repo.listIncomes(ctx.db, userId, period, limit, offset).map(presentIncome);
  const total = repo.sumIncomes(ctx.db, userId, period);
  return { period, items, count: repo.countIncomes(ctx.db, userId, period), total_cents: total };
}

export function updateIncome(ctx, userId, id, patch) {
  return transaction(ctx.db, () => {
    const current = repo.findIncome(ctx.db, userId, id);
    if (!current) throw notFound('No encontré ese ingreso.');
    assertWritablePeriod(ctx, userId, current.period);

    const date = patch.date !== undefined ? checkDate(patch.date) : current.date;
    const period = periodOf(date);
    if (period !== current.period) assertWritablePeriod(ctx, userId, period);

    return presentIncome(
      repo.updateIncome(ctx.db, {
        id,
        description: patch.description ?? current.description,
        amountCents: patch.amountCents ?? current.amount_cents,
        date,
        period,
        nowIso: nowIso(ctx)
      })
    );
  });
}

export function deleteIncome(ctx, userId, id) {
  return transaction(ctx.db, () => {
    const current = repo.findIncome(ctx.db, userId, id);
    if (!current) throw notFound('No encontré ese ingreso.');
    assertWritablePeriod(ctx, userId, current.period);
    repo.deleteIncome(ctx.db, id);
    return { deleted: true, income: presentIncome(current) };
  });
}

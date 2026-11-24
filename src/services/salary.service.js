import { isValidDate, nextSalaryDate } from '../domain/dates.js';
import { validationError } from '../errors.js';
import { insertSalary, listSalaryHistory, salaryAt } from '../repositories/salary.repository.js';
import { today } from './context.js';
import { presentSalary } from './presenters.js';

export function getCurrentSalary(ctx, userId) {
  const day = today(ctx);
  const row = salaryAt(ctx.db, userId, day);
  if (!row) return { configured: false, salary: null, next_pay_date: nextSalaryDate(day, 1) };
  return {
    configured: true,
    salary: presentSalary(row),
    next_pay_date: nextSalaryDate(day, row.pay_day)
  };
}

/** RN-01/RN-02: inserta historial; nunca sobrescribe ni toca cierres. */
export function setSalary(ctx, userId, { amountCents, payDay, effectiveFrom }) {
  const day = today(ctx);
  const from = effectiveFrom ?? day;
  if (!isValidDate(from)) throw validationError('La fecha de vigencia no es válida.');

  const previous = salaryAt(ctx.db, userId, day);
  insertSalary(ctx.db, {
    userId,
    amountCents,
    payDay: payDay ?? previous?.pay_day ?? 1,
    effectiveFrom: from
  });
  return getCurrentSalary(ctx, userId);
}

export const getSalaryHistory = (ctx, userId) =>
  listSalaryHistory(ctx.db, userId).map(presentSalary);

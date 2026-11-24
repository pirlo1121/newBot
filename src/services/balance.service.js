import { formatCop } from '../domain/money.js';
import { sumExpenses } from '../repositories/expenses.repository.js';
import { listInstances, sumPaidInstances } from '../repositories/fixedExpenses.repository.js';
import { sumIncomes } from '../repositories/incomes.repository.js';
import { salaryForPeriod } from './periods.service.js';

/** RN-10: salario + ingresos extras − fijos pagados − gastos extras. */
export function getBalance(ctx, userId, period) {
  const salary = salaryForPeriod(ctx, userId, period);
  const salaryCents = salary?.amount_cents ?? 0;
  const extraIncomeCents = sumIncomes(ctx.db, userId, period);
  const fixedPaidCents = sumPaidInstances(ctx.db, userId, period);
  const extraExpenseCents = sumExpenses(ctx.db, userId, period);
  const fixedPendingCents = listInstances(ctx.db, userId, period, 'pending').reduce(
    (sum, row) => sum + row.amount_cents,
    0
  );
  const balanceCents = salaryCents + extraIncomeCents - fixedPaidCents - extraExpenseCents;

  return {
    period,
    salary_configured: Boolean(salary),
    salary_cents: salaryCents,
    extra_income_cents: extraIncomeCents,
    fixed_paid_cents: fixedPaidCents,
    fixed_pending_cents: fixedPendingCents,
    extra_expense_cents: extraExpenseCents,
    balance_cents: balanceCents,
    currency: 'COP',
    formatted: {
      salary: formatCop(salaryCents),
      extra_income: formatCop(extraIncomeCents),
      fixed_paid: formatCop(fixedPaidCents),
      fixed_pending: formatCop(fixedPendingCents),
      extra_expenses: formatCop(extraExpenseCents),
      balance: formatCop(balanceCents)
    }
  };
}

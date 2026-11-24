import { categoryLabel } from '../domain/categories.js';
import { formatCop } from '../domain/money.js';

export const presentIncome = (row) => ({
  id: row.id,
  description: row.description,
  amount_cents: row.amount_cents,
  amount: formatCop(row.amount_cents),
  date: row.date,
  period: row.period
});

export const presentExpense = (row) => ({
  id: row.id,
  name: row.name,
  amount_cents: row.amount_cents,
  amount: formatCop(row.amount_cents),
  category: row.category,
  category_label: categoryLabel(row.category),
  date: row.date,
  period: row.period
});

export const presentTemplate = (row) => ({
  id: row.id,
  name: row.name,
  amount_cents: row.amount_cents,
  amount: formatCop(row.amount_cents),
  due_day: row.due_day
});

export const presentInstance = (row, today) => ({
  id: row.id,
  fixed_expense_id: row.fixed_expense_id,
  name: row.name,
  period: row.period,
  amount_cents: row.amount_cents,
  amount: formatCop(row.amount_cents),
  due_date: row.due_date,
  paid: row.paid === 1,
  paid_at: row.paid_at,
  overdue: row.paid === 0 && row.due_date < today
});

export const presentSalary = (row) =>
  row && {
    id: row.id,
    amount_cents: row.amount_cents,
    amount: formatCop(row.amount_cents),
    pay_day: row.pay_day,
    effective_from: row.effective_from
  };

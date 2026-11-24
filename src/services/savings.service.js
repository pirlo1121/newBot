import { formatCop } from '../domain/money.js';
import { getSavings as findSavings, listSavingsMovements } from '../repositories/savings.repository.js';

export function getSavings(ctx, userId) {
  const row = findSavings(ctx.db, userId);
  const balance = row?.balance_cents ?? 0;
  return { balance_cents: balance, balance: formatCop(balance), updated_at: row?.updated_at ?? null };
}

export function getSavingsMovements(ctx, userId, limit) {
  return {
    items: listSavingsMovements(ctx.db, userId, limit).map((row) => ({
      id: row.id,
      amount_cents: row.amount_cents,
      amount: formatCop(row.amount_cents),
      type: row.type,
      period: row.period,
      closure_id: row.closure_id,
      created_at: row.created_at
    }))
  };
}

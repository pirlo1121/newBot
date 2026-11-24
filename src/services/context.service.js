import { closureTriggerDate, nowInTz, periodLabel } from '../domain/dates.js';
import { formatCop } from '../domain/money.js';
import { listInstances } from '../repositories/fixedExpenses.repository.js';
import { listOpenPeriodsBefore } from '../repositories/periods.repository.js';
import { getBalance } from './balance.service.js';
import { getLatestClosure } from './closure.service.js';
import { activePeriod, today } from './context.js';
import { getLimitStatus } from './limits.service.js';
import { currentPayDay } from './periods.service.js';
import { presentInstance } from './presenters.js';
import { getCurrentSalary } from './salary.service.js';
import { getSavings } from './savings.service.js';

/** Resumen de una sola llamada para que la IA se ubique (§9.1). */
export function getContext(ctx, userId) {
  const day = today(ctx);
  const period = activePeriod(ctx);
  const payDay = currentPayDay(ctx, userId);
  const pending = listInstances(ctx.db, userId, period, 'pending').map((row) => presentInstance(row, day));
  const pendingTotal = pending.reduce((sum, item) => sum + item.amount_cents, 0);
  const latest = getLatestClosure(ctx, userId);

  return {
    today: day,
    now_local: nowInTz(ctx.clock.now(), ctx.timezone),
    timezone: ctx.timezone,
    period,
    period_label: periodLabel(period),
    open_previous_periods: listOpenPeriodsBefore(ctx.db, userId, period).map((row) => ({
      period: row.period,
      closes_on: closureTriggerDate(row.period, payDay)
    })),
    salary: getCurrentSalary(ctx, userId),
    limit: getLimitStatus(ctx, userId, period),
    balance: getBalance(ctx, userId, period),
    savings: getSavings(ctx, userId),
    pending_bills: {
      items: pending,
      overdue_count: pending.filter((item) => item.overdue).length,
      total_cents: pendingTotal,
      total: formatCop(pendingTotal)
    },
    latest_closure: latest
      ? { period: latest.period, saved: latest.formatted.saved, balance: latest.formatted.balance }
      : null
  };
}

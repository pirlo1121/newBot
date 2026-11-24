import { periodLabel } from '../domain/dates.js';
import { percentOf } from '../domain/closure.js';
import { formatCop } from '../domain/money.js';
import { sumExpenses } from '../repositories/expenses.repository.js';
import { insertNotification } from '../repositories/notifications.repository.js';
import { findPeriod, setPeriodAlerts, setPeriodLimit } from '../repositories/periods.repository.js';
import { upsertMonthlyLimit } from '../repositories/settings.repository.js';
import { transaction } from '../db/transaction.js';
import { activePeriod, nowIso } from './context.js';
import { ensurePeriod } from './periods.service.js';

/** Umbrales del 80 % y 100 %, redondeados hacia arriba al centavo. */
export function thresholds(limitCents) {
  return { t80: Math.ceil((limitCents * 80) / 100), t100: limitCents };
}

function alertText(type, period, spentCents, limitCents) {
  const label = periodLabel(period);
  if (type === 'limite_100') {
    return `🚨 Alcanzaste tu límite de gastos extras de ${label}: llevas ${formatCop(spentCents)} de ${formatCop(limitCents)}.`;
  }
  return `⚠️ Ya usaste el 80 % de tu límite de gastos extras de ${label}: llevas ${formatCop(spentCents)} de ${formatCop(limitCents)}.`;
}

/**
 * RN-09: encola un aviso por umbral y periodo. Si se cruzan los dos en la
 * misma operación, solo se envía el del 100 % y el del 80 % queda marcado.
 * Devuelve los avisos encolados en esta llamada.
 */
export function evaluateAlerts(ctx, userId, period) {
  return transaction(ctx.db, () => {
    const row = findPeriod(ctx.db, userId, period);
    if (!row || row.status !== 'open' || !row.limit_cents) return [];

    const spent = sumExpenses(ctx.db, userId, period);
    const { t80, t100 } = thresholds(row.limit_cents);
    const now = nowIso(ctx);
    let alert80 = row.alert_80_at;
    let alert100 = row.alert_100_at;
    let type = null;

    if (spent >= t100 && !alert100) {
      type = 'limite_100';
      alert100 = now;
      alert80 ??= now;
    } else if (spent >= t80 && !alert80) {
      type = 'limite_80';
      alert80 = now;
    }
    if (!type) return [];

    setPeriodAlerts(ctx.db, row.id, alert80, alert100);
    const text = alertText(type, period, spent, row.limit_cents);
    insertNotification(ctx.db, {
      userId,
      type,
      period,
      payload: { spent_cents: spent, limit_cents: row.limit_cents },
      text
    });
    return [{ type, text }];
  });
}

export function getLimitStatus(ctx, userId, period = activePeriod(ctx)) {
  const row = findPeriod(ctx.db, userId, period);
  const spent = sumExpenses(ctx.db, userId, period);
  const limit = row?.limit_cents ?? null;
  if (!limit) {
    return {
      period,
      configured: false,
      limit_cents: null,
      spent_cents: spent,
      formatted: { spent: formatCop(spent) }
    };
  }
  const { t80, t100 } = thresholds(limit);
  const remaining = limit - spent;
  return {
    period,
    configured: true,
    limit_cents: limit,
    spent_cents: spent,
    remaining_cents: remaining,
    percent: percentOf(spent, limit),
    threshold_80_cents: t80,
    threshold_100_cents: t100,
    alert_80_sent: Boolean(row.alert_80_at),
    alert_100_sent: Boolean(row.alert_100_at),
    formatted: {
      limit: formatCop(limit),
      spent: formatCop(spent),
      remaining: formatCop(remaining),
      threshold_80: formatCop(t80)
    }
  };
}

/**
 * RN-08: guarda el límite por defecto y lo aplica al periodo activo.
 * Limpia marcas de umbrales que el acumulado ya no alcanza y reevalúa.
 */
export function setMonthlyLimit(ctx, userId, limitCents) {
  return transaction(ctx.db, () => {
    upsertMonthlyLimit(ctx.db, userId, limitCents, nowIso(ctx));
    const period = activePeriod(ctx);
    const row = ensurePeriod(ctx, userId, period);
    setPeriodLimit(ctx.db, row.id, limitCents);

    const spent = sumExpenses(ctx.db, userId, period);
    const { t80, t100 } = thresholds(limitCents);
    setPeriodAlerts(
      ctx.db,
      row.id,
      spent >= t80 ? row.alert_80_at : null,
      spent >= t100 ? row.alert_100_at : null
    );

    const alerts = evaluateAlerts(ctx, userId, period);
    return { ...getLimitStatus(ctx, userId, period), alerts };
  });
}

/** Al abrir un mes nuevo tras un cierre, toma el límite vigente (RN-16). */
export function applyCurrentLimit(ctx, userId, period, limitCents) {
  const row = findPeriod(ctx.db, userId, period);
  if (!row || row.status !== 'open' || row.limit_cents === limitCents) return;
  setPeriodLimit(ctx.db, row.id, limitCents);
  evaluateAlerts(ctx, userId, period);
}

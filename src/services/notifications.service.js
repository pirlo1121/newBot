import { notFound } from '../errors.js';
import * as repo from '../repositories/notifications.repository.js';
import { nowIso } from './context.js';

const present = (row) => ({
  id: row.id,
  type: row.type,
  period: row.period,
  text: row.text,
  payload: JSON.parse(row.payload_json),
  created_at: row.created_at,
  delivered_at: row.delivered_at
});

export const listPending = (ctx, userId) =>
  repo.listPendingNotifications(ctx.db, userId, 50).map(present);

export function ack(ctx, userId, id) {
  const row = repo.findNotification(ctx.db, userId, id);
  if (!row) throw notFound('No encontré esa notificación.');
  repo.ackNotification(ctx.db, id, nowIso(ctx));
  return present(repo.findNotification(ctx.db, userId, id));
}

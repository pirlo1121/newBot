export const findPeriod = (db, userId, period) =>
  db.prepare('SELECT * FROM periods WHERE user_id = ? AND period = ?').get(userId, period);

export const insertPeriod = (db, userId, period, limitCents) =>
  db
    .prepare(
      `INSERT INTO periods (user_id, period, limit_cents) VALUES (?, ?, ?)
       ON CONFLICT (user_id, period) DO NOTHING RETURNING *`
    )
    .get(userId, period, limitCents);

export const listOpenPeriodsBefore = (db, userId, period) =>
  db
    .prepare(
      `SELECT * FROM periods WHERE user_id = ? AND status = 'open' AND period < ?
       ORDER BY period`
    )
    .all(userId, period);

export const setPeriodLimit = (db, periodId, limitCents) =>
  db.prepare('UPDATE periods SET limit_cents = ? WHERE id = ?').run(limitCents, periodId);

export const setPeriodAlerts = (db, periodId, alert80At, alert100At) =>
  db
    .prepare('UPDATE periods SET alert_80_at = ?, alert_100_at = ? WHERE id = ?')
    .run(alert80At, alert100At, periodId);

export const markPeriodClosed = (db, periodId, closedAt) =>
  db
    .prepare(
      `UPDATE periods SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'`
    )
    .run(closedAt, periodId);

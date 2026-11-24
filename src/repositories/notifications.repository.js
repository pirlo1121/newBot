export const insertNotification = (db, { userId, type, period, payload, text }) =>
  db
    .prepare(
      `INSERT INTO notifications (user_id, type, period, payload_json, text)
       VALUES (?, ?, ?, ?, ?) RETURNING *`
    )
    .get(userId, type, period, JSON.stringify(payload), text);

export const listPendingNotifications = (db, userId, limit = 50) =>
  db
    .prepare(
      'SELECT * FROM notifications WHERE user_id = ? AND delivered_at IS NULL ORDER BY id LIMIT ?'
    )
    .all(userId, limit);

export const findNotification = (db, userId, id) =>
  db.prepare('SELECT * FROM notifications WHERE user_id = ? AND id = ?').get(userId, id);

export const ackNotification = (db, id, nowIso) =>
  db
    .prepare('UPDATE notifications SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL')
    .run(nowIso, id);

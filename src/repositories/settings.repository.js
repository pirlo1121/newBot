export const getSettings = (db, userId) =>
  db.prepare('SELECT * FROM settings WHERE user_id = ?').get(userId);

export const upsertMonthlyLimit = (db, userId, limitCents, nowIso) =>
  db
    .prepare(
      `INSERT INTO settings (user_id, monthly_limit_cents, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET monthly_limit_cents = excluded.monthly_limit_cents,
                                           updated_at = excluded.updated_at`
    )
    .run(userId, limitCents, nowIso);

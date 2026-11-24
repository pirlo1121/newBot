export const getSavings = (db, userId) =>
  db.prepare('SELECT * FROM savings WHERE user_id = ?').get(userId);

export const addToSavings = (db, userId, amountCents, nowIso) =>
  db
    .prepare(
      `INSERT INTO savings (user_id, balance_cents, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET balance_cents = balance_cents + excluded.balance_cents,
                                           updated_at = excluded.updated_at
       RETURNING *`
    )
    .get(userId, amountCents, nowIso);

export const insertSavingsMovement = (db, { userId, amountCents, type, period, closureId, nowIso }) =>
  db
    .prepare(
      `INSERT INTO savings_movements (user_id, amount_cents, type, period, closure_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .get(userId, amountCents, type, period, closureId, nowIso);

export const listSavingsMovements = (db, userId, limit) =>
  db
    .prepare('SELECT * FROM savings_movements WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(userId, limit);

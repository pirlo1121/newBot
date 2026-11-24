export const insertIncome = (db, { userId, description, amountCents, date, period }) =>
  db
    .prepare(
      `INSERT INTO extra_incomes (user_id, description, amount_cents, date, period)
       VALUES (?, ?, ?, ?, ?) RETURNING *`
    )
    .get(userId, description, amountCents, date, period);

export const findIncome = (db, userId, id) =>
  db.prepare('SELECT * FROM extra_incomes WHERE user_id = ? AND id = ?').get(userId, id);

export const updateIncome = (db, { id, description, amountCents, date, period, nowIso }) =>
  db
    .prepare(
      `UPDATE extra_incomes SET description = ?, amount_cents = ?, date = ?, period = ?, updated_at = ?
       WHERE id = ? RETURNING *`
    )
    .get(description, amountCents, date, period, nowIso, id);

export const deleteIncome = (db, id) =>
  db.prepare('DELETE FROM extra_incomes WHERE id = ?').run(id);

export const listIncomes = (db, userId, period, limit, offset) =>
  db
    .prepare(
      `SELECT * FROM extra_incomes WHERE user_id = ? AND period = ?
       ORDER BY date DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(userId, period, limit, offset);

export const countIncomes = (db, userId, period) =>
  db
    .prepare('SELECT COUNT(*) AS n FROM extra_incomes WHERE user_id = ? AND period = ?')
    .get(userId, period).n;

export const sumIncomes = (db, userId, period) =>
  db
    .prepare(
      'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM extra_incomes WHERE user_id = ? AND period = ?'
    )
    .get(userId, period).total;

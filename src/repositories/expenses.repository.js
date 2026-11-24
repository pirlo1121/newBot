export const insertExpense = (db, { userId, name, amountCents, category, date, period }) =>
  db
    .prepare(
      `INSERT INTO extra_expenses (user_id, name, amount_cents, category, date, period)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .get(userId, name, amountCents, category, date, period);

export const findExpense = (db, userId, id) =>
  db.prepare('SELECT * FROM extra_expenses WHERE user_id = ? AND id = ?').get(userId, id);

export const updateExpense = (db, { id, name, amountCents, category, date, period, nowIso }) =>
  db
    .prepare(
      `UPDATE extra_expenses SET name = ?, amount_cents = ?, category = ?, date = ?, period = ?, updated_at = ?
       WHERE id = ? RETURNING *`
    )
    .get(name, amountCents, category, date, period, nowIso, id);

export const deleteExpense = (db, id) =>
  db.prepare('DELETE FROM extra_expenses WHERE id = ?').run(id);

export const sumExpenses = (db, userId, period) =>
  db
    .prepare(
      'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM extra_expenses WHERE user_id = ? AND period = ?'
    )
    .get(userId, period).total;

function buildFilter(userId, { period, category, from, to }) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (period) {
    where.push('period = ?');
    params.push(period);
  }
  if (category === 'sin_categoria') {
    where.push('category IS NULL');
  } else if (category) {
    where.push('category = ?');
    params.push(category);
  }
  if (from) {
    where.push('date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('date <= ?');
    params.push(to);
  }
  return { sql: where.join(' AND '), params };
}

/** Listado flexible. `sort` y `order` ya vienen validados por la ruta. */
export function listExpenses(db, userId, filters, { sort, order, limit, offset }) {
  const { sql, params } = buildFilter(userId, filters);
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  const orderBy =
    sort === 'amount'
      ? `amount_cents ${dir}, date DESC, id DESC`
      : `date ${dir}, created_at ${dir}, id ${dir}`;
  const items = db
    .prepare(`SELECT * FROM extra_expenses WHERE ${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS total FROM extra_expenses WHERE ${sql}`
    )
    .get(...params);
  return { items, count: totals.n, totalCents: totals.total };
}

export const recentExpenses = (db, userId, limit) =>
  db
    .prepare(
      `SELECT * FROM extra_expenses WHERE user_id = ?
       ORDER BY date DESC, created_at DESC, id DESC LIMIT ?`
    )
    .all(userId, limit);

export const expensesBetween = (db, userId, from, to) =>
  db
    .prepare(
      `SELECT * FROM extra_expenses WHERE user_id = ? AND date BETWEEN ? AND ?
       ORDER BY date DESC, created_at DESC, id DESC`
    )
    .all(userId, from, to);

export const totalsByCategory = (db, userId, period) =>
  db
    .prepare(
      `SELECT COALESCE(category, 'sin_categoria') AS category,
              SUM(amount_cents) AS total_cents, COUNT(*) AS count
       FROM extra_expenses WHERE user_id = ? AND period = ?
       GROUP BY COALESCE(category, 'sin_categoria')
       ORDER BY total_cents DESC, category ASC`
    )
    .all(userId, period);

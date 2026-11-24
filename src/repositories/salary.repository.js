export const insertSalary = (db, { userId, amountCents, payDay, effectiveFrom }) =>
  db
    .prepare(
      `INSERT INTO salary_history (user_id, amount_cents, pay_day, effective_from)
       VALUES (?, ?, ?, ?) RETURNING *`
    )
    .get(userId, amountCents, payDay, effectiveFrom);

/** Salario vigente en una fecha: la fila más reciente con effective_from <= fecha. */
export const salaryAt = (db, userId, date) =>
  db
    .prepare(
      `SELECT * FROM salary_history
       WHERE user_id = ? AND effective_from <= ?
       ORDER BY effective_from DESC, id DESC LIMIT 1`
    )
    .get(userId, date);

export const listSalaryHistory = (db, userId) =>
  db
    .prepare(
      'SELECT * FROM salary_history WHERE user_id = ? ORDER BY effective_from DESC, id DESC'
    )
    .all(userId);

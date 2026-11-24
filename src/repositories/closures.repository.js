export const insertClosure = (db, c) =>
  db
    .prepare(
      `INSERT INTO period_closures (user_id, period, salary_cents, extra_income_cents, fixed_paid_cents,
         extra_expense_cents, balance_cents, saved_cents, deficit_cents, top_category, bottom_category, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    )
    .get(
      c.userId, c.period, c.salaryCents, c.extraIncomeCents, c.fixedPaidCents, c.extraExpenseCents,
      c.balanceCents, c.savedCents, c.deficitCents, c.topCategory, c.bottomCategory, c.closedAt
    );

export const insertCategoryTotal = (db, closureId, category, totalCents) =>
  db
    .prepare('INSERT INTO closure_category_totals (closure_id, category, total_cents) VALUES (?, ?, ?)')
    .run(closureId, category, totalCents);

export const findClosure = (db, userId, period) =>
  db.prepare('SELECT * FROM period_closures WHERE user_id = ? AND period = ?').get(userId, period);

export const latestClosure = (db, userId) =>
  db
    .prepare('SELECT * FROM period_closures WHERE user_id = ? ORDER BY period DESC LIMIT 1')
    .get(userId);

export const listClosures = (db, userId, limit) =>
  db
    .prepare('SELECT * FROM period_closures WHERE user_id = ? ORDER BY period DESC LIMIT ?')
    .all(userId, limit);

export const categoryTotalsOf = (db, closureId) =>
  db
    .prepare(
      `SELECT category, total_cents FROM closure_category_totals WHERE closure_id = ?
       ORDER BY total_cents DESC, category ASC`
    )
    .all(closureId);

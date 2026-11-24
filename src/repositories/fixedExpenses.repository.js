// Plantillas

export const insertTemplate = (db, { userId, name, amountCents, dueDay }) =>
  db
    .prepare(
      `INSERT INTO fixed_expenses (user_id, name, amount_cents, due_day)
       VALUES (?, ?, ?, ?) RETURNING *`
    )
    .get(userId, name, amountCents, dueDay);

export const findTemplate = (db, userId, id) =>
  db
    .prepare('SELECT * FROM fixed_expenses WHERE user_id = ? AND id = ? AND active = 1')
    .get(userId, id);

export const listTemplates = (db, userId) =>
  db
    .prepare('SELECT * FROM fixed_expenses WHERE user_id = ? AND active = 1 ORDER BY due_day, name')
    .all(userId);

export const updateTemplate = (db, { id, name, amountCents, dueDay, nowIso }) =>
  db
    .prepare(
      `UPDATE fixed_expenses SET name = ?, amount_cents = ?, due_day = ?, updated_at = ?
       WHERE id = ? RETURNING *`
    )
    .get(name, amountCents, dueDay, nowIso, id);

export const deleteTemplate = (db, id) =>
  db.prepare('DELETE FROM fixed_expenses WHERE id = ?').run(id);

// Instancias (facturas)

export const insertInstance = (db, { userId, templateId, period, name, amountCents, dueDate }) =>
  db
    .prepare(
      `INSERT INTO fixed_expense_instances (user_id, fixed_expense_id, period, name, amount_cents, due_date)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, fixed_expense_id, period) DO NOTHING RETURNING *`
    )
    .get(userId, templateId, period, name, amountCents, dueDate);

export const findInstance = (db, userId, id) =>
  db
    .prepare('SELECT * FROM fixed_expense_instances WHERE user_id = ? AND id = ?')
    .get(userId, id);

export const findPendingInstanceForTemplate = (db, templateId, period) =>
  db
    .prepare(
      `SELECT * FROM fixed_expense_instances
       WHERE fixed_expense_id = ? AND period = ? AND paid = 0`
    )
    .get(templateId, period);

export const updateInstance = (db, { id, name, amountCents, dueDate }) =>
  db
    .prepare(
      'UPDATE fixed_expense_instances SET name = ?, amount_cents = ?, due_date = ? WHERE id = ?'
    )
    .run(name, amountCents, dueDate, id);

/** Borra las facturas pendientes de una plantilla en periodos abiertos. */
export const deletePendingInstancesOfTemplate = (db, userId, templateId) =>
  db
    .prepare(
      `DELETE FROM fixed_expense_instances
       WHERE user_id = ? AND fixed_expense_id = ? AND paid = 0
         AND period IN (SELECT period FROM periods WHERE user_id = ? AND status = 'open')`
    )
    .run(userId, templateId, userId);

export function listInstances(db, userId, period, status) {
  const paidFilter = status === 'paid' ? 'AND paid = 1' : status === 'pending' ? 'AND paid = 0' : '';
  return db
    .prepare(
      `SELECT * FROM fixed_expense_instances WHERE user_id = ? AND period = ? ${paidFilter}
       ORDER BY due_date, name, id`
    )
    .all(userId, period);
}

export const markInstancePaid = (db, id, paidAt) =>
  db
    .prepare('UPDATE fixed_expense_instances SET paid = 1, paid_at = ? WHERE id = ? AND paid = 0')
    .run(paidAt, id);

export const sumPaidInstances = (db, userId, period) =>
  db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM fixed_expense_instances
       WHERE user_id = ? AND period = ? AND paid = 1`
    )
    .get(userId, period).total;

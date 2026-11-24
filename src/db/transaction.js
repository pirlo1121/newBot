const depth = new WeakMap();

/**
 * Ejecuta `fn` dentro de BEGIN IMMEDIATE … COMMIT.
 * Las llamadas anidadas reutilizan la transacción externa (savepoint),
 * así un servicio puede llamar a otro sin abrir transacciones paralelas.
 */
export function transaction(db, fn) {
  const level = depth.get(db) ?? 0;
  const savepoint = `sp_${level}`;

  db.exec(level === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
  depth.set(db, level + 1);

  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      throw new Error('transaction() no admite funciones asíncronas.');
    }
    db.exec(level === 0 ? 'COMMIT' : `RELEASE ${savepoint}`);
    return result;
  } catch (error) {
    if (level === 0) {
      db.exec('ROLLBACK');
    } else {
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
    }
    throw error;
  } finally {
    depth.set(db, level);
  }
}

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { openDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';
import { transaction } from '../../src/db/transaction.js';

test('migrar dos veces no falla ni repite migraciones', () => {
  const db = openDatabase(':memory:');
  assert.deepEqual(migrate(db), ['001_init.sql', '002_idempotency.sql']);
  assert.deepEqual(migrate(db), []);

  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name);
  for (const name of [
    'users', 'settings', 'salary_history', 'periods', 'fixed_expenses', 'fixed_expense_instances',
    'extra_incomes', 'extra_expenses', 'period_closures', 'closure_category_totals', 'savings',
    'savings_movements', 'notifications', 'idempotency_keys'
  ]) {
    assert.ok(tables.includes(name), `falta la tabla ${name}`);
  }
});

test('las claves foráneas y los CHECK están activos', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.throws(() =>
    db.prepare("INSERT INTO extra_expenses (user_id, name, amount_cents, date, period) VALUES (99, 'x', 1, '2026-11-01', '2026-11')").run()
  );
  db.prepare('INSERT INTO users (telegram_user_id) VALUES (1)').run();
  assert.throws(() =>
    db.prepare("INSERT INTO extra_expenses (user_id, name, amount_cents, date, period) VALUES (1, 'x', 0, '2026-11-01', '2026-11')").run()
  );
  assert.throws(() =>
    db.prepare("INSERT INTO extra_expenses (user_id, name, amount_cents, category, date, period) VALUES (1, 'x', 1, 'otra', '2026-11-01', '2026-11')").run()
  );
});

test('transaction hace rollback completo y admite anidación', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  assert.throws(() =>
    transaction(db, () => {
      db.prepare('INSERT INTO users (telegram_user_id) VALUES (1)').run();
      transaction(db, () => db.prepare('INSERT INTO users (telegram_user_id) VALUES (2)').run());
      throw new Error('falla');
    })
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);

  transaction(db, () => {
    db.prepare('INSERT INTO users (telegram_user_id) VALUES (1)').run();
    assert.throws(() =>
      transaction(db, () => {
        db.prepare('INSERT INTO users (telegram_user_id) VALUES (2)').run();
        throw new Error('interna');
      })
    );
  });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('archivo en disco: WAL y permisos 600', () => {
  const dir = mkdtempSync(join(tmpdir(), 'finanzas-'));
  try {
    const path = join(dir, 'sub', 'test.db');
    const db = openDatabase(path);
    migrate(db);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(statSync(path).mode & 0o777, 0o600);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

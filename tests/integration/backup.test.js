import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { backupDatabase } from '../../scripts/backup.js';
import { openDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';

test('backup con VACUUM INTO se puede restaurar y respeta la retención', () => {
  const dir = mkdtempSync(join(tmpdir(), 'finanzas-bk-'));
  try {
    const dbPath = join(dir, 'finanzas.db');
    const db = openDatabase(dbPath);
    migrate(db);
    db.prepare('INSERT INTO users (telegram_user_id) VALUES (42)').run();
    db.close();

    const old = join(dir, 'backups', 'finanzas-viejo.db');
    backupDatabase({ dbPath, dir: join(dir, 'backups') });
    writeFileSync(old, '');
    const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    utimesSync(old, longAgo, longAgo);

    const { target, removed } = backupDatabase({ dbPath, dir: join(dir, 'backups'), now: new Date(Date.now() + 1000) });
    assert.deepEqual(removed, ['finanzas-viejo.db']);
    assert.equal(existsSync(old), false);
    assert.equal(statSync(target).mode & 0o777, 0o600);

    // Restaurar = abrir la copia como base principal.
    const restored = openDatabase(target);
    assert.equal(restored.prepare('SELECT telegram_user_id FROM users').get().telegram_user_id, 42);
    assert.deepEqual(migrate(restored), []);
    restored.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

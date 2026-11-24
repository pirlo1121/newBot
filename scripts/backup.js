import 'dotenv/config';

import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/connection.js';

/**
 * Copia consistente con VACUUM INTO y retención de 30 días.
 * Uso: npm run backup [-- <directorio>]   (por defecto ./data/backups)
 */
export function backupDatabase({ dbPath, dir, now = new Date(), retentionDays = 30 }) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const target = join(dir, `finanzas-${stamp}.db`);

  const db = openDatabase(dbPath);
  try {
    db.prepare('VACUUM INTO ?').run(target);
  } finally {
    db.close();
  }
  chmodSync(target, 0o600);

  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const removed = [];
  for (const file of readdirSync(dir)) {
    if (!/^finanzas-.*\.db$/.test(file)) continue;
    const path = join(dir, file);
    if (statSync(path).mtimeMs < cutoff) {
      unlinkSync(path);
      removed.push(file);
    }
  }
  return { target, removed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig(process.env);
  const dir = resolve(process.argv[2] ?? join(resolve(config.dbPath, '..'), 'backups'));
  const { target, removed } = backupDatabase({ dbPath: config.dbPath, dir });
  console.log(`Backup creado: ${target}`);
  if (removed.length) console.log(`Backups antiguos eliminados: ${removed.join(', ')}`);
}

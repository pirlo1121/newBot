import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const isMemory = (path) => path === ':memory:' || path.startsWith('file::memory:');

/**
 * Abre la base SQLite con los PRAGMA de AGENTS.md §15.
 * Crea el directorio de datos (700) y deja el archivo con permisos 600.
 */
export function openDatabase(dbPath) {
  if (!isMemory(dbPath)) {
    const dir = dirname(resolve(dbPath));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  if (!isMemory(dbPath)) {
    try {
      chmodSync(resolve(dbPath), 0o600);
    } catch {
      // En sistemas sin permisos POSIX no es crítico.
    }
  }

  return db;
}

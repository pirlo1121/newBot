import pino from 'pino';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openDatabase } from '../../src/db/connection.js';
import { migrate } from '../../src/db/migrate.js';

export const API_KEY = 'clave-de-prueba-1234567890';

/** Reloj fijo que se puede mover. Las horas se dan en hora de Bogotá (UTC−5). */
export function createClock(local = '2026-11-24T10:00') {
  let current = new Date(`${local}:00-05:00`);
  return {
    now: () => new Date(current),
    set(value) {
      current = new Date(`${value}:00-05:00`);
    }
  };
}

/** App con base en memoria, migraciones aplicadas y reloj inyectado. */
export function createTestApp({ now = '2026-11-24T10:00', env = {} } = {}) {
  const config = loadConfig({
    NODE_ENV: 'test',
    INTERNAL_API_KEY: API_KEY,
    LOG_LEVEL: 'silent',
    ALLOWED_TELEGRAM_USER_IDS: '111',
    ...env
  });
  const db = openDatabase(':memory:');
  migrate(db);
  const clock = createClock(now);
  const app = createApp({ config, db, clock, logger: pino({ level: 'silent' }) });

  const call = (method, path, body) => {
    const req = request(app)[method](path).set('x-api-key', API_KEY);
    return body === undefined ? req : req.send(body);
  };

  return {
    app,
    db,
    clock,
    config,
    get: (path) => call('get', path),
    post: (path, body) => call('post', path, body ?? {}),
    put: (path, body) => call('put', path, body),
    patch: (path, body) => call('patch', path, body),
    del: (path) => call('delete', path)
  };
}

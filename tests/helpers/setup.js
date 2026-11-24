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

/** Levanta la app de pruebas en un puerto efímero de loopback. */
export async function listen(app) {
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return { baseUrl: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

/**
 * Servidor falso compatible con OpenAI: responde en orden los mensajes del
 * guion y guarda cada petición recibida.
 */
export async function fakeAiServer(script) {
  const { createServer } = await import('node:http');
  const requests = [];
  let index = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const body = JSON.parse(raw);
      requests.push({ headers: req.headers, url: req.url, body });
      const step = typeof script === 'function' ? script(body, index) : script[Math.min(index, script.length - 1)];
      index += 1;
      if (step?.status) {
        res.writeHead(step.status).end('falla');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: step }] }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    close: () => new Promise((r) => server.close(r))
  };
}

let callSeq = 0;
/** Mensaje del asistente que pide herramientas. */
export const toolCall = (...calls) => ({
  role: 'assistant',
  content: null,
  tool_calls: calls.map(([name, args]) => ({
    id: `call_${++callSeq}`,
    type: 'function',
    function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}) }
  }))
});
export const say = (content) => ({ role: 'assistant', content });

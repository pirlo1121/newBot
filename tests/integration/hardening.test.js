import assert from 'node:assert/strict';
import test from 'node:test';

import request from 'supertest';

import { API_KEY, createTestApp } from '../helpers/setup.js';

test('Idempotency-Key repite la respuesta sin duplicar el gasto', async () => {
  const t = createTestApp();
  const send = (body) =>
    request(t.app).post('/api/expenses').set('x-api-key', API_KEY).set('idempotency-key', 'gasto-0001').send(body);

  const first = await send({ name: 'Cena', amount: '45.000' });
  const second = await send({ name: 'Cena', amount: '45.000' });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.headers['idempotent-replay'], 'true');
  assert.deepEqual(second.body, first.body);
  assert.equal((await t.get('/api/expenses')).body.data.count, 1);

  const other = await send({ name: 'Otra', amount: '1' });
  assert.equal(other.status, 409);
  assert.equal(other.body.error.code, 'CONFLICT');

  // Pasadas 24 h la clave caduca.
  t.clock.set('2026-11-25T11:00');
  const later = await send({ name: 'Otra', amount: '1', date: '2026-11-25' });
  assert.equal(later.status, 201);

  const bad = await request(t.app).post('/api/expenses').set('x-api-key', API_KEY).set('idempotency-key', 'x').send({});
  assert.equal(bad.status, 400);
});

test('límite de tasa de la API', async () => {
  const t = createTestApp();
  const { createApp } = await import('../../src/app.js');
  const pino = (await import('pino')).default;
  const app = createApp({
    config: { ...t.config, apiRateLimitPerMinute: 2 },
    db: t.db,
    clock: t.clock,
    logger: pino({ level: 'silent' })
  });
  await request(app).get('/api/salary').set('x-api-key', API_KEY);
  await request(app).get('/api/salary').set('x-api-key', API_KEY);
  const r = await request(app).get('/api/salary').set('x-api-key', API_KEY);
  assert.equal(r.status, 429);
  assert.equal(r.body.error.code, 'RATE_LIMITED');
});

test('/health verifica la base y los errores 500 se reportan sin detalles', async () => {
  const t = createTestApp();
  let r = await request(t.app).get('/health');
  assert.equal(r.body.data.database, 'ok');

  const { createApp } = await import('../../src/app.js');
  const pino = (await import('pino')).default;
  const reported = [];
  const app = createApp({
    config: t.config,
    db: t.db,
    clock: { now: () => { throw new Error('reloj roto con secreto'); } },
    logger: pino({ level: 'silent' }),
    onServerError: (err) => reported.push(err.message)
  });
  r = await request(app).get('/api/balance').set('x-api-key', API_KEY);
  assert.equal(r.status, 500);
  assert.equal(r.body.error.code, 'INTERNAL_ERROR');
  assert.equal(JSON.stringify(r.body).includes('secreto'), false);
  assert.deepEqual(reported, ['reloj roto con secreto']);
});

test('cuerpo demasiado grande responde 413 con envelope', async () => {
  const t = createTestApp();
  const r = await t.post('/api/expenses', { name: 'x'.repeat(200_000), amount: '1' });
  assert.equal(r.status, 413);
  assert.equal(r.body.error.code, 'VALIDATION_ERROR');
});

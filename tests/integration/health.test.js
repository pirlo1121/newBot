import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';

import pino from 'pino';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';

const config = loadConfig({
  NODE_ENV: 'test',
  INTERNAL_API_KEY: 'clave-de-prueba-1234567890',
  LOG_LEVEL: 'silent'
});

const app = createApp({ config, logger: pino({ level: 'silent' }) });

test('GET /health responde 200 sin autenticación', async () => {
  const response = await request(app).get('/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.data.status, 'up');
  assert.equal(response.body.data.database, 'not_configured');
  assert.match(response.headers['x-request-id'], /^[A-Za-z0-9._-]+$/);
});

test('respeta el X-Request-Id entrante', async () => {
  const response = await request(app)
    .get('/health')
    .set('x-request-id', 'peticion-de-prueba');

  assert.equal(response.headers['x-request-id'], 'peticion-de-prueba');
});

test('rechaza /api sin API key', async () => {
  const response = await request(app).get('/api/no-existe');

  assert.equal(response.status, 401);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error.code, 'UNAUTHORIZED');
});

test('rechaza /api con una API key incorrecta', async () => {
  const response = await request(app)
    .get('/api/no-existe')
    .set('x-api-key', 'otra-clave-1234567890');

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'UNAUTHORIZED');
});

test('con API key válida responde 404 de ruta desconocida', async () => {
  const response = await request(app)
    .get('/api/no-existe')
    .set('x-api-key', config.internalApiKey);

  assert.equal(response.status, 404);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error.code, 'NOT_FOUND');
});

test('no escribe la API key en los logs', async () => {
  const chunks = [];
  const stream = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    }
  });
  const logger = pino({ level: 'info' }, stream);
  const loggedApp = createApp({ config, logger });

  await request(loggedApp)
    .get('/api/no-existe')
    .set('x-api-key', config.internalApiKey);

  await new Promise((resolve) => setTimeout(resolve, 20));

  const logs = chunks.join('');
  assert.ok(logs.length > 0);
  assert.equal(logs.includes(config.internalApiKey), false);
  assert.equal(logs.includes('x-api-key'), false);
});

test('responde 400 ante JSON inválido', async () => {
  const response = await request(app)
    .post('/api/no-existe')
    .set('x-api-key', config.internalApiKey)
    .set('content-type', 'application/json')
    .send('{');

  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../../src/config.js';

const baseEnv = { INTERNAL_API_KEY: 'clave-de-prueba-1234567890' };

test('aplica valores por defecto', () => {
  const config = loadConfig(baseEnv);

  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.port, 3000);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.dbPath, './data/finanzas.db');
  assert.equal(config.timezone, 'America/Bogota');
  assert.equal(config.aiBaseUrl, 'https://api.openai.com/v1');
  assert.equal(config.logLevel, 'info');
  assert.deepEqual(config.allowedTelegramUserIds, []);
  assert.equal(config.telegramBotToken, undefined);
  assert.equal(config.aiModel, undefined);
});

test('exige INTERNAL_API_KEY', () => {
  assert.throws(() => loadConfig({}), /INTERNAL_API_KEY/);
});

test('rechaza una API key corta', () => {
  assert.throws(
    () => loadConfig({ INTERNAL_API_KEY: 'corta' }),
    /al menos 16 caracteres/
  );
});

test('convierte y recorta los valores de entorno', () => {
  const config = loadConfig({
    ...baseEnv,
    NODE_ENV: 'test',
    PORT: '4000',
    ALLOWED_TELEGRAM_USER_IDS: '123, 456, 123',
    AI_MODEL: '  modelo-de-prueba  '
  });

  assert.equal(config.nodeEnv, 'test');
  assert.equal(config.port, 4000);
  assert.deepEqual(config.allowedTelegramUserIds, [123, 456]);
  assert.equal(config.aiModel, 'modelo-de-prueba');
});

test('rechaza IDs de Telegram inválidos', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, ALLOWED_TELEGRAM_USER_IDS: '123, abc' }),
    /ALLOWED_TELEGRAM_USER_IDS/
  );
});

test('rechaza un puerto inválido', () => {
  assert.throws(() => loadConfig({ ...baseEnv, PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ ...baseEnv, PORT: 'abc' }), /PORT/);
});

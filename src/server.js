import 'dotenv/config';

import pino from 'pino';

import { createApiClient } from './ai/apiClient.js';
import { createOrchestrator } from './ai/orchestrator.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/connection.js';
import { migrate } from './db/migrate.js';
import { scheduleDaily } from './scheduler.js';
import { ensureClosures } from './services/closure.service.js';
import { createServiceContext } from './services/context.js';
import { ensureOwner } from './services/users.service.js';
import { createTelegramBot } from './telegram/bot.js';

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

process.env.TZ = config.timezone;
const logger = pino({ level: config.logLevel });

// Al arrancar: migraciones pendientes y cierres vencidos antes de aceptar mensajes (§15).
const db = openDatabase(config.dbPath);
const applied = migrate(db);
if (applied.length) logger.info({ applied }, 'migraciones aplicadas');

const ctx = createServiceContext({ db, timezone: config.timezone });
const owner = ensureOwner(db, config.allowedTelegramUserIds[0] ?? 0);
const runClosures = () => {
  const closed = ensureClosures(ctx, owner.id);
  if (closed.length) logger.info({ periods: closed.map((c) => c.period) }, 'periodos cerrados');
  return closed;
};
runClosures();

let telegram = null;
let lastOwnerAlert = 0;
const onServerError = (err, req) => {
  // Alerta al dueño ante errores 500, como máximo una cada 10 minutos.
  if (!telegram || Date.now() - lastOwnerAlert < 10 * 60_000) return;
  lastOwnerAlert = Date.now();
  telegram.notifyOwner(`⚠️ Error interno en Finanzas Bot (${req.method} ${req.path}, id ${req.id}). Revisa los logs.`);
};

const app = createApp({ config, logger, db, onServerError });

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, env: config.nodeEnv }, 'servidor iniciado');
  startBot();
});

server.on('error', (error) => {
  logger.error({ err: error }, 'no se pudo iniciar el servidor');
  process.exit(1);
});

function startBot() {
  const missing = [];
  if (!config.telegramBotToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (config.allowedTelegramUserIds.length === 0) missing.push('ALLOWED_TELEGRAM_USER_IDS');
  if (!config.aiModel) missing.push('AI_MODEL');
  if (missing.length) {
    logger.warn({ missing }, 'bot de Telegram desactivado: faltan variables; solo corre la API');
    return;
  }

  const api = createApiClient({
    baseUrl: `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`,
    apiKey: config.internalApiKey
  });
  const orchestrator = createOrchestrator({
    baseUrl: config.aiBaseUrl,
    apiKey: config.aiApiKey,
    model: config.aiModel,
    api,
    timezone: config.timezone,
    logger
  });
  telegram = createTelegramBot({
    token: config.telegramBotToken,
    allowedUserIds: config.allowedTelegramUserIds,
    orchestrator,
    api,
    logger
  });
  telegram.start();
}

const daily = scheduleDaily({
  hour: 0,
  minute: 5,
  tz: config.timezone,
  logger,
  job: async () => {
    runClosures();
    await telegram?.deliverNotifications();
  }
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'apagando servidor');
  daily.stop();
  setTimeout(() => {
    logger.warn('cierre forzado tras 10 segundos');
    process.exit(1);
  }, 10_000).unref();

  await telegram?.stop().catch(() => {});
  server.close((error) => {
    db.close();
    if (error) {
      logger.error({ err: error }, 'error al cerrar el servidor');
      process.exit(1);
    }
    process.exit(0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdown(signal));
}

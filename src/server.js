import 'dotenv/config';

import pino from 'pino';

import { createApp } from './app.js';
import { loadConfig } from './config.js';

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

process.env.TZ = config.timezone;
const logger = pino({ level: config.logLevel });
const app = createApp({ config, logger });

const server = app.listen(config.port, config.host, () => {
  logger.info(
    { host: config.host, port: config.port, env: config.nodeEnv },
    'servidor iniciado'
  );
});

server.on('error', (error) => {
  logger.error({ err: error }, 'no se pudo iniciar el servidor');
  process.exit(1);
});

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'apagando servidor');

  server.close((error) => {
    if (error) {
      logger.error({ err: error }, 'error al cerrar el servidor');
      process.exit(1);
    }
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('cierre forzado tras 10 segundos');
    process.exit(1);
  }, 10_000).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => shutdown(signal));
}

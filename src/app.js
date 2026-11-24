import { randomUUID } from 'node:crypto';

import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';

import { requireApiKey } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { idempotency } from './middleware/idempotency.js';
import { rateLimit } from './middleware/rateLimit.js';
import { requestContext } from './middleware/requestContext.js';
import { expensesRoutes } from './routes/expenses.routes.js';
import { financeRoutes } from './routes/finance.routes.js';
import { fixedExpensesRoutes } from './routes/fixedExpenses.routes.js';
import { incomesRoutes } from './routes/incomes.routes.js';
import { salaryRoutes } from './routes/salary.routes.js';
import { systemRoutes } from './routes/system.routes.js';
import { createServiceContext } from './services/context.js';

const requestIdPattern = /^[A-Za-z0-9._-]{1,100}$/;
const sensitiveHeaders = ['x-api-key', 'authorization', 'cookie'];

const baseReqSerializer = pino.stdSerializers.req;

/** Evita que la API key y otras credenciales terminen en los logs. */
function safeReqSerializer(req) {
  const serialized = baseReqSerializer(req);
  const headers = { ...serialized.headers };

  for (const header of sensitiveHeaders) {
    delete headers[header];
  }

  return { ...serialized, headers };
}

function genReqId(req) {
  const incoming = req.headers['x-request-id'];
  if (typeof incoming === 'string' && requestIdPattern.test(incoming)) {
    return incoming;
  }
  return randomUUID();
}

/**
 * Construye la app sin abrir el puerto, para poder probarla con supertest.
 * `db` es opcional: sin base solo responden /health y la autenticación.
 * `clock` permite fijar la fecha en pruebas.
 */
export function createApp({
  config,
  logger = pino({ level: config.logLevel }),
  db = null,
  clock = { now: () => new Date() },
  onServerError
}) {
  const app = express();
  app.disable('x-powered-by');

  app.use(pinoHttp({ logger, genReqId, serializers: { req: safeReqSerializer } }));

  app.use((req, res, next) => {
    res.setHeader('x-request-id', req.id);
    next();
  });

  app.use(express.json({ limit: '100kb' }));

  // GET http://127.0.0.1:3000/health
  app.get('/health', (req, res) => {
    let database = 'not_configured';
    if (db) {
      try {
        db.prepare('SELECT 1').get();
        database = 'ok';
      } catch {
        database = 'error';
      }
    }
    res.status(database === 'error' ? 503 : 200).json({
      ok: database !== 'error',
      data: {
        service: 'finanzas-bot',
        status: database === 'error' ? 'degraded' : 'up',
        database,
        uptime_s: Math.floor(process.uptime())
      }
    });
  });

  app.use('/api', requireApiKey(config.internalApiKey));

  if (db) {
    const ctx = createServiceContext({ db, clock, timezone: config.timezone });
    const api = express.Router();

    api.use(rateLimit({ windowMs: 60_000, max: config.apiRateLimitPerMinute ?? 300, clock }));
    api.use(requestContext(ctx, { ownerTelegramId: config.allowedTelegramUserIds[0] ?? 0 }));
    api.use(idempotency(ctx));

    api.use('/', systemRoutes(ctx));
    api.use('/salary', salaryRoutes(ctx));
    api.use('/incomes', incomesRoutes(ctx));
    api.use('/fixed-expenses', fixedExpensesRoutes(ctx));
    api.use('/expenses', expensesRoutes(ctx));
    api.use('/', financeRoutes(ctx));

    app.use('/api', api);
  }

  app.use(notFoundHandler);
  app.use(errorHandler({ onServerError }));

  return app;
}

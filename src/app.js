import { randomUUID } from 'node:crypto';

import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';

import { requireApiKey } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

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
 */
export function createApp({ config, logger = pino({ level: config.logLevel }) }) {
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
    res.json({
      ok: true,
      data: {
        service: 'finanzas-bot',
        status: 'up',
        database: 'not_configured',
        uptime_s: Math.floor(process.uptime())
      }
    });
  });

  app.use('/api', requireApiKey(config.internalApiKey));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

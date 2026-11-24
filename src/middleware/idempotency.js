import { createHash } from 'node:crypto';

import { validationError, conflict } from '../errors.js';
import { nowIso } from '../services/context.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
const WINDOW_MS = 24 * 60 * 60 * 1000;

const hashBody = (body) => createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');

/**
 * Header opcional `Idempotency-Key` en escrituras (Fase 11). La misma clave
 * con la misma petición repite la respuesta guardada; con otra petición, 409.
 * Las claves caducan a las 24 horas.
 */
export function idempotency(ctx) {
  return function idempotencyMiddleware(req, res, next) {
    const key = req.get('idempotency-key');
    if (!key || !WRITE_METHODS.has(req.method)) {
      next();
      return;
    }
    if (!KEY_PATTERN.test(key)) {
      throw validationError('Idempotency-Key debe tener entre 8 y 100 caracteres alfanuméricos.');
    }

    const now = ctx.clock.now().getTime();
    const cutoff = new Date(now - WINDOW_MS).toISOString();
    ctx.db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(cutoff);

    const fingerprint = `${req.method} ${req.originalUrl} ${hashBody(req.body)}`;
    const stored = ctx.db
      .prepare('SELECT * FROM idempotency_keys WHERE user_id = ? AND key = ?')
      .get(req.userId, key);

    if (stored) {
      if (stored.fingerprint !== fingerprint) {
        throw conflict('Esa Idempotency-Key ya se usó con otra petición.');
      }
      res.setHeader('idempotent-replay', 'true');
      res.status(stored.status).type('application/json').send(stored.response_json);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (payload) => {
      if (res.statusCode < 500) {
        ctx.db
          .prepare(
            `INSERT OR IGNORE INTO idempotency_keys (user_id, key, fingerprint, status, response_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(req.userId, key, fingerprint, res.statusCode, JSON.stringify(payload), nowIso(ctx));
      }
      return originalJson(payload);
    };
    next();
  };
}

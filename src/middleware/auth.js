import { timingSafeEqual } from 'node:crypto';

/**
 * Exige el header X-Api-Key en las rutas /api.
 * La comparación es de tiempo constante para no filtrar el secreto.
 */
export function requireApiKey(expectedKey) {
  const expected = Buffer.from(expectedKey, 'utf8');

  return function apiKeyMiddleware(req, res, next) {
    const provided = req.get('x-api-key');
    const received = Buffer.from(provided ?? '', 'utf8');

    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      res.status(401).json({
        ok: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'API key inválida o ausente.',
          details: []
        }
      });
      return;
    }

    next();
  };
}

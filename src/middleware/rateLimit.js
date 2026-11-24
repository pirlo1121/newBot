/**
 * Límite de tasa simple de ventana fija para la API interna (Fase 11).
 * La API escucha solo en loopback; esto frena bucles descontrolados del bot.
 */
export function rateLimit({ windowMs = 60_000, max = 300, clock = { now: () => new Date() } } = {}) {
  let windowStart = 0;
  let count = 0;

  return function rateLimitMiddleware(req, res, next) {
    const now = clock.now().getTime();
    if (now - windowStart >= windowMs) {
      windowStart = now;
      count = 0;
    }
    count += 1;
    if (count > max) {
      res.setHeader('retry-after', Math.ceil((windowStart + windowMs - now) / 1000));
      res.status(429).json({
        ok: false,
        error: { code: 'RATE_LIMITED', message: 'Demasiadas peticiones; intenta en un momento.', details: [] }
      });
      return;
    }
    next();
  };
}

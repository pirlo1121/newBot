/** Ventana deslizante por usuario de Telegram (p. ej. 20 mensajes por minuto). */
export function createRateLimiter({ max = 20, windowMs = 60_000, now = () => Date.now() } = {}) {
  const hits = new Map();
  return function allow(key) {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((at) => t - at < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.set(key, recent);
    return true;
  };
}

import { activePeriod, today } from '../services/context.js';
import { ensureClosures } from '../services/closure.service.js';
import { ensurePeriod } from '../services/periods.service.js';
import { ensureOwner } from '../services/users.service.js';

/**
 * Resuelve el usuario dueño, procesa cierres vencidos y asegura el periodo
 * activo antes de cada request (AGENTS.md §8.2). Deja `meta` para el envelope.
 */
export function requestContext(ctx, { ownerTelegramId = 0 } = {}) {
  return function requestContextMiddleware(req, res, next) {
    const owner = ensureOwner(ctx.db, ownerTelegramId);
    req.userId = owner.id;

    // /closures/run hace su propia verificación (y su dry_run debe ver lo pendiente).
    if (!(req.method === 'POST' && req.path === '/closures/run')) {
      ensureClosures(ctx, owner.id);
    }
    ensurePeriod(ctx, owner.id, activePeriod(ctx));

    res.locals.meta = { today: today(ctx), period: activePeriod(ctx) };
    next();
  };
}

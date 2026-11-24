import { isoNow, periodOf, todayInTz } from '../domain/dates.js';

/**
 * Contexto de servicios: base, reloj inyectable y zona horaria.
 * clock.now() devuelve un Date; en tests se fija la fecha.
 */
export function createServiceContext({ db, clock = { now: () => new Date() }, timezone = 'America/Bogota' }) {
  return { db, clock, timezone };
}

export const today = (ctx) => todayInTz(ctx.clock.now(), ctx.timezone);
export const activePeriod = (ctx) => periodOf(today(ctx));
export const nowIso = (ctx) => isoNow(ctx.clock);

import { Router } from 'express';

import { amountFromBody } from '../domain/money.js';
import { notFound, validationError } from '../errors.js';
import { getBalance } from '../services/balance.service.js';
import * as closures from '../services/closure.service.js';
import { activePeriod } from '../services/context.js';
import { getLimitStatus, setMonthlyLimit } from '../services/limits.service.js';
import { getSavings, getSavingsMovements } from '../services/savings.service.js';
import { send } from './respond.js';
import { amountFields, parse, periodField, z } from './validation.js';

const periodQuery = z.object({ period: periodField.optional() });
const limitQuery = (max, def) => z.object({ limit: z.coerce.number().int().min(1).max(max).default(def) });
const runSchema = z.object({ dry_run: z.boolean().default(false) });

/** Límite, saldo, ahorro y cierres. */
export function financeRoutes(ctx) {
  const router = Router();

  // GET http://127.0.0.1:3000/api/limits/current
  router.get('/limits/current', (req, res) => send(res, getLimitStatus(ctx, req.userId)));

  // PUT http://127.0.0.1:3000/api/limits/monthly
  router.put('/limits/monthly', (req, res) => {
    const body = parse(z.object(amountFields), req.body);
    const amountCents = amountFromBody(body);
    if (amountCents === undefined) throw validationError('El monto del límite es obligatorio.');
    send(res, setMonthlyLimit(ctx, req.userId, amountCents));
  });

  // GET http://127.0.0.1:3000/api/balance?period=YYYY-MM
  router.get('/balance', (req, res) => {
    const { period } = parse(periodQuery, req.query);
    send(res, getBalance(ctx, req.userId, period ?? activePeriod(ctx)));
  });

  // GET http://127.0.0.1:3000/api/savings
  router.get('/savings', (req, res) => send(res, getSavings(ctx, req.userId)));

  // GET http://127.0.0.1:3000/api/savings/movements?limit=20
  router.get('/savings/movements', (req, res) => {
    const { limit } = parse(limitQuery(100, 20), req.query);
    send(res, getSavingsMovements(ctx, req.userId, limit));
  });

  // GET http://127.0.0.1:3000/api/closures?limit=12
  router.get('/closures', (req, res) => {
    const { limit } = parse(limitQuery(100, 12), req.query);
    send(res, { items: closures.listClosures(ctx, req.userId, limit) });
  });

  // GET http://127.0.0.1:3000/api/closures/latest
  router.get('/closures/latest', (req, res) => {
    const latest = closures.getLatestClosure(ctx, req.userId);
    if (!latest) throw notFound('Todavía no hay cierres mensuales.');
    send(res, latest);
  });

  // POST http://127.0.0.1:3000/api/closures/run
  router.post('/closures/run', (req, res) => {
    const { dry_run: dryRun } = parse(runSchema, req.body);
    const items = closures.ensureClosures(ctx, req.userId, { dryRun });
    send(res, { dry_run: dryRun, items });
  });

  // GET http://127.0.0.1:3000/api/closures/{period}
  router.get('/closures/:period', (req, res) => {
    const { period } = parse(z.object({ period: periodField }), req.params);
    const closure = closures.getClosure(ctx, req.userId, period);
    if (!closure) throw notFound(`No hay cierre para ${period}.`);
    send(res, closure);
  });

  return router;
}

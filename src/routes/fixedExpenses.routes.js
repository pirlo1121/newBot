import { Router } from 'express';

import { amountFromBody } from '../domain/money.js';
import { validationError } from '../errors.js';
import { activePeriod } from '../services/context.js';
import * as fixed from '../services/fixedExpenses.service.js';
import { send } from './respond.js';
import { amountFields, dateField, idParam, parse, periodField, text, z } from './validation.js';

const dueDay = z.coerce.number().int().min(1).max(31);
const createSchema = z.object({ name: text(), ...amountFields, due_day: dueDay.default(1) });
const patchSchema = z.object({ name: text().optional(), ...amountFields, due_day: dueDay.optional() });
const instancesSchema = z.object({
  period: periodField.optional(),
  status: z.enum(['pending', 'paid', 'all']).default('all')
});
const paySchema = z.object({ paid_at: dateField.optional() });

export function fixedExpensesRoutes(ctx) {
  const router = Router();

  // GET http://127.0.0.1:3000/api/fixed-expenses
  router.get('/', (req, res) => send(res, { items: fixed.listTemplates(ctx, req.userId) }));

  // POST http://127.0.0.1:3000/api/fixed-expenses
  router.post('/', (req, res) => {
    const body = parse(createSchema, req.body);
    const amountCents = amountFromBody(body);
    if (amountCents === undefined) throw validationError('El monto es obligatorio.');
    send(res, fixed.createTemplate(ctx, req.userId, { name: body.name, amountCents, dueDay: body.due_day }), 201);
  });

  // GET http://127.0.0.1:3000/api/fixed-expenses/instances?period=YYYY-MM&status=pending|paid|all
  router.get('/instances', (req, res) => {
    const query = parse(instancesSchema, req.query);
    send(res, fixed.listInstances(ctx, req.userId, { ...query, period: query.period ?? activePeriod(ctx) }));
  });

  // POST http://127.0.0.1:3000/api/fixed-expenses/instances/{id}/pay
  router.post('/instances/:id/pay', (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(paySchema, req.body);
    send(res, fixed.payInstance(ctx, req.userId, id, { paidAt: body.paid_at }));
  });

  // PATCH http://127.0.0.1:3000/api/fixed-expenses/{id}
  router.patch('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(patchSchema, req.body);
    send(
      res,
      fixed.updateTemplate(ctx, req.userId, id, {
        name: body.name,
        amountCents: amountFromBody(body),
        dueDay: body.due_day
      })
    );
  });

  // DELETE http://127.0.0.1:3000/api/fixed-expenses/{id}
  router.delete('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    send(res, fixed.deleteTemplate(ctx, req.userId, id));
  });

  return router;
}

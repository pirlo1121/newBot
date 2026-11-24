import { Router } from 'express';

import { amountFromBody } from '../domain/money.js';
import { validationError } from '../errors.js';
import { activePeriod } from '../services/context.js';
import * as incomes from '../services/incomes.service.js';
import { send } from './respond.js';
import { amountFields, dateField, idParam, paging, parse, periodField, text, z } from './validation.js';

const listSchema = z.object({ period: periodField.optional(), ...paging });
const createSchema = z.object({ description: text(200), ...amountFields, date: dateField.optional() });
const patchSchema = z.object({
  description: text(200).optional(),
  ...amountFields,
  date: dateField.optional()
});

export function incomesRoutes(ctx) {
  const router = Router();

  // GET http://127.0.0.1:3000/api/incomes?period=YYYY-MM&limit=20&offset=0
  router.get('/', (req, res) => {
    const query = parse(listSchema, req.query);
    send(res, incomes.listIncomes(ctx, req.userId, { ...query, period: query.period ?? activePeriod(ctx) }));
  });

  // POST http://127.0.0.1:3000/api/incomes
  router.post('/', (req, res) => {
    const body = parse(createSchema, req.body);
    const amountCents = amountFromBody(body);
    if (amountCents === undefined) throw validationError('El monto es obligatorio.');
    send(
      res,
      incomes.createIncome(ctx, req.userId, { description: body.description, amountCents, date: body.date }),
      201
    );
  });

  // PATCH http://127.0.0.1:3000/api/incomes/{id}
  router.patch('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(patchSchema, req.body);
    send(
      res,
      incomes.updateIncome(ctx, req.userId, id, {
        description: body.description,
        amountCents: amountFromBody(body),
        date: body.date
      })
    );
  });

  // DELETE http://127.0.0.1:3000/api/incomes/{id}
  router.delete('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    send(res, incomes.deleteIncome(ctx, req.userId, id));
  });

  return router;
}

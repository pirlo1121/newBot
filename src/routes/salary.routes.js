import { Router } from 'express';

import { amountFromBody } from '../domain/money.js';
import { validationError } from '../errors.js';
import * as salary from '../services/salary.service.js';
import { send } from './respond.js';
import { amountFields, dateField, parse, z } from './validation.js';

const putSchema = z.object({
  ...amountFields,
  pay_day: z.coerce.number().int().min(1).max(31).optional(),
  effective_from: dateField.optional()
});

export function salaryRoutes(ctx) {
  const router = Router();

  // GET http://127.0.0.1:3000/api/salary
  router.get('/', (req, res) => send(res, salary.getCurrentSalary(ctx, req.userId)));

  // PUT http://127.0.0.1:3000/api/salary
  router.put('/', (req, res) => {
    const body = parse(putSchema, req.body);
    const amountCents = amountFromBody(body);
    if (amountCents === undefined) throw validationError('El monto del salario es obligatorio.');
    send(
      res,
      salary.setSalary(ctx, req.userId, {
        amountCents,
        payDay: body.pay_day,
        effectiveFrom: body.effective_from
      })
    );
  });

  // GET http://127.0.0.1:3000/api/salary/history
  router.get('/history', (req, res) => send(res, { items: salary.getSalaryHistory(ctx, req.userId) }));

  return router;
}

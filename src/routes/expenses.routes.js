import { Router } from 'express';

import { CATEGORIES } from '../domain/categories.js';
import { amountFromBody } from '../domain/money.js';
import { validationError } from '../errors.js';
import { activePeriod } from '../services/context.js';
import * as expenses from '../services/expenses.service.js';
import { send } from './respond.js';
import { amountFields, dateField, idParam, paging, parse, periodField, text, z } from './validation.js';

const category = z.enum(CATEGORIES).nullable();

const createSchema = z.object({
  name: text(),
  ...amountFields,
  category: category.optional(),
  date: dateField.optional()
});
const patchSchema = z.object({
  name: text().optional(),
  ...amountFields,
  category: category.optional(),
  date: dateField.optional()
});
const listSchema = z.object({
  period: periodField.optional(),
  category: z.enum(expenses.VALID_CATEGORY_FILTERS).optional(),
  from: dateField.optional(),
  to: dateField.optional(),
  sort: z.enum(['date', 'amount']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  ...paging
});
const recentSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(10) });
const byDaySchema = z.object({ days: z.coerce.number().int().min(0).max(31).default(3) });
const byCategorySchema = z.object({ period: periodField.optional() });

export function expensesRoutes(ctx) {
  const router = Router();

  // GET http://127.0.0.1:3000/api/expenses?period=&category=&from=&to=&sort=date|amount&order=desc&limit=&offset=
  router.get('/', (req, res) => {
    const q = parse(listSchema, req.query);
    const period = q.period ?? (q.from || q.to ? undefined : activePeriod(ctx));
    send(
      res,
      expenses.listExpenses(
        ctx,
        req.userId,
        { period, category: q.category, from: q.from, to: q.to },
        { sort: q.sort, order: q.order, limit: q.limit, offset: q.offset }
      )
    );
  });

  // GET http://127.0.0.1:3000/api/expenses/recent?limit=10
  router.get('/recent', (req, res) => {
    const { limit } = parse(recentSchema, req.query);
    send(res, expenses.recentExpenses(ctx, req.userId, limit));
  });

  // GET http://127.0.0.1:3000/api/expenses/by-day?days=3
  router.get('/by-day', (req, res) => {
    const { days } = parse(byDaySchema, req.query);
    send(res, expenses.expensesByDay(ctx, req.userId, days));
  });

  // GET http://127.0.0.1:3000/api/expenses/by-category?period=YYYY-MM
  router.get('/by-category', (req, res) => {
    const { period } = parse(byCategorySchema, req.query);
    send(res, expenses.expensesByCategory(ctx, req.userId, period ?? activePeriod(ctx)));
  });

  // POST http://127.0.0.1:3000/api/expenses
  router.post('/', (req, res) => {
    const body = parse(createSchema, req.body);
    const amountCents = amountFromBody(body);
    if (amountCents === undefined) throw validationError('El monto es obligatorio.');
    send(
      res,
      expenses.createExpense(ctx, req.userId, {
        name: body.name,
        amountCents,
        category: body.category,
        date: body.date
      }),
      201
    );
  });

  // PATCH http://127.0.0.1:3000/api/expenses/{id}
  router.patch('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    const body = parse(patchSchema, req.body);
    send(
      res,
      expenses.updateExpense(ctx, req.userId, id, {
        name: body.name,
        amountCents: amountFromBody(body),
        category: body.category,
        date: body.date
      })
    );
  });

  // DELETE http://127.0.0.1:3000/api/expenses/{id}
  router.delete('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    send(res, expenses.deleteExpense(ctx, req.userId, id));
  });

  return router;
}

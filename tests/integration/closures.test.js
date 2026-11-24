import assert from 'node:assert/strict';
import test from 'node:test';

import pino from 'pino';
import request from 'supertest';

import { createApp } from '../../src/app.js';
import { createServiceContext } from '../../src/services/context.js';
import { closePeriod, ensureClosures } from '../../src/services/closure.service.js';
import { API_KEY, createTestApp } from '../helpers/setup.js';

const savings = async (t) => (await t.get('/api/savings')).body.data.balance_cents;

test('cierre normal: resumen, ahorro, notificación y mes nuevo', async () => {
  const t = createTestApp();
  await t.put('/api/salary', { amount: '3.500.000' });
  await t.post('/api/incomes', { description: 'Venta', amount: '500.000' });
  const f = await t.post('/api/fixed-expenses', { name: 'Arriendo', amount: '900.000', due_day: 1 });
  await t.post(`/api/fixed-expenses/instances/${f.body.data.instance.id}/pay`);
  await t.post('/api/expenses', { name: 'Cena', amount: '300.000', category: 'comida' });
  await t.post('/api/expenses', { name: 'Bus', amount: '100.000', category: 'transporte' });
  await t.post('/api/expenses', { name: 'Otro', amount: '50.000' });

  t.clock.set('2026-11-30T23:59');
  assert.equal((await t.get('/api/closures')).body.data.items.length, 0);

  t.clock.set('2026-12-01T00:05');
  const r = await t.get('/api/closures/latest');
  const c = r.body.data;
  assert.equal(c.period, '2026-11');
  assert.equal(c.income_cents, 400_000_000);
  assert.equal(c.fixed_paid_cents, 90_000_000);
  assert.equal(c.extra_expense_cents, 45_000_000);
  assert.equal(c.balance_cents, 265_000_000);
  assert.equal(c.saved_cents, 265_000_000);
  assert.equal(c.top_category, 'comida');
  assert.equal(c.bottom_category, 'sin_categoria');
  assert.equal(c.categories.length, 3);
  assert.equal(await savings(t), 265_000_000);

  const moves = (await t.get('/api/savings/movements')).body.data.items;
  assert.equal(moves.length, 1);
  assert.equal(moves[0].closure_id, c.id);

  const notes = (await t.get('/api/notifications/pending')).body.data.items;
  const report = notes.find((n) => n.type === 'cierre_mensual');
  assert.match(report.text, /Cierre de noviembre de 2026/);
  assert.match(report.text, /Ahorro del mes: \$2\.650\.000/);

  assert.equal((await t.get('/api/closures/2026-11')).body.data.id, c.id);
  assert.equal((await t.get('/api/closures/2026-10')).status, 404);
  assert.equal((await t.get('/api/closures/nope')).status, 400);

  const fixed = (await t.get('/api/fixed-expenses/instances')).body.data;
  assert.equal(fixed.period, '2026-12');
  assert.equal(fixed.items[0].paid, false);
});

test('doble ejecución y conexiones paralelas no duplican el cierre', async () => {
  const t = createTestApp();
  await t.put('/api/salary', { amount: '1.000.000' });
  t.clock.set('2026-12-01T00:05');

  const ctx = createServiceContext({ db: t.db, clock: t.clock });
  ensureClosures(ctx, 1);
  ensureClosures(ctx, 1);
  assert.equal(closePeriod(ctx, 1, '2026-11'), null);
  await Promise.all([t.post('/api/closures/run'), t.post('/api/closures/run'), t.get('/api/context')]);

  assert.equal((await t.get('/api/closures')).body.data.items.length, 1);
  assert.equal(await savings(t), 100_000_000);
  assert.equal(
    t.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE type = 'cierre_mensual'").get().n,
    1
  );
});

test('dry_run muestra lo pendiente sin escribir', async () => {
  const t = createTestApp();
  await t.put('/api/salary', { amount: '1.000.000', pay_day: 10 });
  t.clock.set('2026-12-10T08:00');
  let r = await t.post('/api/closures/run', { dry_run: true });
  assert.equal(r.body.data.items.length, 1);
  assert.equal(r.body.data.items[0].saved_cents, 100_000_000);
  assert.equal(await (async () => (await t.post('/api/closures/run', { dry_run: true })).body.data.items.length)(), 1);

  r = await t.post('/api/closures/run');
  assert.equal(r.body.data.items[0].period, '2026-11');
  r = await t.post('/api/closures/run');
  assert.equal(r.body.data.items.length, 0);
});

test('día de pago 10: el mes anterior sigue abierto hasta el pago', async () => {
  const t = createTestApp();
  await t.put('/api/salary', { amount: '2.000.000', pay_day: 10 });
  await t.post('/api/fixed-expenses', { name: 'Arriendo', amount: '500.000', due_day: 5 });

  t.clock.set('2026-12-03T10:00');
  let r = await t.get('/api/context');
  assert.equal(r.body.data.period, '2026-12');
  assert.deepEqual(r.body.data.open_previous_periods, [{ period: '2026-11', closes_on: '2026-12-10' }]);

  // Noviembre admite correcciones.
  r = await t.post('/api/expenses', { name: 'olvidado', amount: '10.000', date: '2026-11-29' });
  assert.equal(r.status, 201);
  // Nueva plantilla en diciembre no crea factura en noviembre.
  await t.post('/api/fixed-expenses', { name: 'Gym', amount: '80.000', due_day: 1 });
  r = await t.get('/api/fixed-expenses/instances?period=2026-11');
  assert.deepEqual(r.body.data.items.map((i) => i.name), ['Arriendo']);

  t.clock.set('2026-12-10T00:05');
  r = await t.get('/api/closures/latest');
  assert.equal(r.body.data.period, '2026-11');
  assert.equal(r.body.data.balance_cents, 200_000_000 - 1_000_000);

  r = await t.post('/api/expenses', { name: 'tarde', amount: '1', date: '2026-11-30' });
  assert.equal(r.status, 409);
  r = await t.get('/api/fixed-expenses/instances?period=2026-12');
  assert.deepEqual(r.body.data.items.map((i) => i.name).sort(), ['Arriendo', 'Gym']);
});

test('diciembre → enero, saldo negativo y sin salario', async () => {
  const t = createTestApp({ now: '2026-12-15T10:00' });
  await t.post('/api/expenses', { name: 'x', amount: '50.000' });
  t.clock.set('2027-01-01T00:05');
  const r = await t.get('/api/closures/latest');
  assert.equal(r.body.data.period, '2026-12');
  assert.equal(r.body.data.deficit_cents, 5_000_000);
  assert.equal(r.body.data.saved_cents, 0);
  assert.equal(r.body.data.salary_missing, true);
  assert.equal(r.body.data.top_category, 'sin_categoria');
  assert.equal(r.body.data.bottom_category, null);
  assert.equal(await savings(t), 0);
  const report = (await t.get('/api/notifications/pending')).body.data.items[0].text;
  assert.match(report, /No había salario configurado/);
  assert.match(report, /Déficit del mes: \$50\.000/);
});

test('sin gastos ambas categorías son null; febrero con día 31', async () => {
  const t = createTestApp({ now: '2027-01-20T10:00' });
  await t.put('/api/salary', { amount: '1.000.000', pay_day: 31 });
  t.clock.set('2027-02-27T23:00');
  assert.equal((await t.get('/api/closures')).body.data.items.length, 0);
  t.clock.set('2027-02-28T00:05');
  const c = (await t.get('/api/closures/latest')).body.data;
  assert.equal(c.period, '2027-01');
  assert.equal(c.top_category, null);
  assert.equal(c.bottom_category, null);
});

test('reiniciar el proceso no repite cierres ni avisos', async () => {
  const t = createTestApp();
  await t.put('/api/limits/monthly', { amount: '100.000' });
  await t.post('/api/expenses', { name: 'x', amount: '100.000' });
  t.clock.set('2026-12-01T00:05');
  await t.get('/api/context');

  // Nueva app sobre la misma base = reinicio.
  const app2 = createApp({ config: t.config, db: t.db, clock: t.clock, logger: pino({ level: 'silent' }) });
  await request(app2).get('/api/context').set('x-api-key', API_KEY);
  await request(app2).post('/api/closures/run').set('x-api-key', API_KEY);

  const types = t.db.prepare('SELECT type FROM notifications ORDER BY id').all().map((n) => n.type);
  assert.deepEqual(types, ['limite_100', 'cierre_mensual']);
});

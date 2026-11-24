import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestApp } from '../helpers/setup.js';

test('salario: configurar, cambiar y conservar historial', async () => {
  const t = createTestApp();

  let r = await t.get('/api/salary');
  assert.equal(r.body.data.configured, false);

  r = await t.put('/api/salary', { amount: '3.500.000', pay_day: 10 });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.salary.amount_cents, 350_000_000);
  assert.equal(r.body.data.salary.pay_day, 10);
  assert.equal(r.body.data.next_pay_date, '2026-12-10');
  assert.deepEqual(r.body.meta, { today: '2026-11-24', period: '2026-11' });

  // Sin pay_day conserva el día anterior.
  r = await t.put('/api/salary', { amount_cents: 400_000_000 });
  assert.equal(r.body.data.salary.pay_day, 10);
  assert.equal(r.body.data.salary.amount, '$4.000.000');

  r = await t.get('/api/salary/history');
  assert.equal(r.body.data.items.length, 2);

  r = await t.put('/api/salary', { amount: '0' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION_ERROR');

  r = await t.put('/api/salary', { amount: '1000', pay_day: 32 });
  assert.equal(r.status, 400);

  r = await t.put('/api/salary', {});
  assert.equal(r.status, 400);
});

test('ingresos extras: CRUD, fecha por defecto y periodo', async () => {
  const t = createTestApp();

  let r = await t.post('/api/incomes', { description: 'Venta de bici', amount: '500.000' });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.date, '2026-11-24');
  assert.equal(r.body.data.period, '2026-11');
  const id = r.body.data.id;

  r = await t.patch(`/api/incomes/${id}`, { amount: '550.000', description: 'Venta bici' });
  assert.equal(r.body.data.amount_cents, 55_000_000);
  assert.equal(r.body.data.description, 'Venta bici');

  r = await t.get('/api/incomes');
  assert.equal(r.body.data.count, 1);
  assert.equal(r.body.data.total_cents, 55_000_000);

  r = await t.post('/api/incomes', { description: 'x', amount: '1', date: '2026-02-30' });
  assert.equal(r.status, 400);

  r = await t.post('/api/incomes', { description: 'futuro', amount: '1', date: '2027-01-01' });
  assert.equal(r.status, 400);

  r = await t.del(`/api/incomes/${id}`);
  assert.equal(r.body.data.deleted, true);

  r = await t.del(`/api/incomes/${id}`);
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'NOT_FOUND');
});

test('ingresos en un periodo cerrado responden 409 PERIOD_CLOSED', async () => {
  const t = createTestApp();
  let r = await t.post('/api/incomes', { description: 'Venta', amount: '100.000' });
  const id = r.body.data.id;

  t.clock.set('2026-12-02T09:00'); // día de pago 1 → noviembre ya cerró
  r = await t.patch(`/api/incomes/${id}`, { amount: '1' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'PERIOD_CLOSED');

  r = await t.del(`/api/incomes/${id}`);
  assert.equal(r.status, 409);

  r = await t.post('/api/incomes', { description: 'tarde', amount: '1', date: '2026-11-30' });
  assert.equal(r.status, 409);

  // Un mes viejo sin fila también se considera cerrado.
  r = await t.post('/api/incomes', { description: 'viejo', amount: '1', date: '2026-03-01' });
  assert.equal(r.status, 409);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestApp } from '../helpers/setup.js';

async function seeded() {
  const t = createTestApp();
  await t.put('/api/salary', { amount: '3.500.000' });
  await t.post('/api/incomes', { description: 'Venta', amount: '500.000' });
  const arriendo = await t.post('/api/fixed-expenses', { name: 'Arriendo', amount: '900.000', due_day: 1 });
  await t.post('/api/fixed-expenses', { name: 'Internet', amount: '200.000', due_day: 15 });
  await t.post(`/api/fixed-expenses/instances/${arriendo.body.data.instance.id}/pay`);
  await t.post('/api/expenses', { name: 'Cena', amount: '45.000', category: 'comida', date: '2026-11-24' });
  await t.post('/api/expenses', { name: 'Taxi', amount: '20.000', category: 'transporte', date: '2026-11-22' });
  await t.post('/api/expenses', { name: 'Zapatos', amount: '250.000', category: 'lujo', date: '2026-11-10' });
  await t.post('/api/expenses', { name: 'Varios', amount: '15.000', date: '2026-11-20' });
  return t;
}

test('saldo del periodo según RN-10 (pendientes no descuentan)', async () => {
  const t = await seeded();
  const r = await t.get('/api/balance');
  const d = r.body.data;
  assert.equal(d.salary_cents, 350_000_000);
  assert.equal(d.extra_income_cents, 50_000_000);
  assert.equal(d.fixed_paid_cents, 90_000_000);
  assert.equal(d.fixed_pending_cents, 20_000_000);
  assert.equal(d.extra_expense_cents, 33_000_000);
  assert.equal(d.balance_cents, 350_000_000 + 50_000_000 - 90_000_000 - 33_000_000);
  assert.equal(d.formatted.balance, '$2.770.000');
});

test('saldo negativo y periodo vacío', async () => {
  const t = createTestApp();
  let r = await t.get('/api/balance?period=2026-10');
  assert.equal(r.body.data.balance_cents, 0);
  await t.post('/api/expenses', { name: 'x', amount: '10.000' });
  r = await t.get('/api/balance');
  assert.equal(r.body.data.formatted.balance, '-$10.000');
  r = await t.get('/api/balance?period=2026-13');
  assert.equal(r.status, 400);
});

test('últimos gastos, por días, por categoría y de mayor a menor', async () => {
  const t = await seeded();

  let r = await t.get('/api/expenses/recent?limit=2');
  assert.deepEqual(r.body.data.items.map((e) => e.name), ['Cena', 'Taxi']);

  r = await t.get('/api/expenses/by-day?days=3');
  assert.equal(r.body.data.from, '2026-11-21');
  assert.equal(r.body.data.days.length, 4);
  assert.equal(r.body.data.days[0].date, '2026-11-24');
  assert.equal(r.body.data.days[0].subtotal, '$45.000');
  assert.equal(r.body.data.days[1].subtotal_cents, 0);
  assert.equal(r.body.data.total_cents, 6_500_000);

  r = await t.get('/api/expenses/by-day?days=0');
  assert.equal(r.body.data.days.length, 1);

  r = await t.get('/api/expenses/by-category');
  const cats = r.body.data.categories;
  assert.deepEqual(cats.map((c) => c.category), ['lujo', 'comida', 'transporte', 'sin_categoria']);
  assert.equal(cats[0].percent, 75.8);

  r = await t.get('/api/expenses?sort=amount&order=desc');
  assert.deepEqual(r.body.data.items.map((e) => e.name), ['Zapatos', 'Cena', 'Taxi', 'Varios']);
  assert.equal(r.body.data.formatted.total, '$330.000');

  r = await t.get('/api/expenses?category=sin_categoria');
  assert.deepEqual(r.body.data.items.map((e) => e.name), ['Varios']);

  r = await t.get('/api/expenses?from=2026-11-20&to=2026-11-22&sort=date&order=asc');
  assert.deepEqual(r.body.data.items.map((e) => e.name), ['Varios', 'Taxi']);

  r = await t.get('/api/expenses?limit=1&offset=1&sort=amount');
  assert.equal(r.body.data.items[0].name, 'Cena');
  assert.equal(r.body.data.count, 4);

  r = await t.get('/api/expenses?limit=500');
  assert.equal(r.status, 400);
});

test('las consultas de un periodo cerrado siguen disponibles', async () => {
  const t = await seeded();
  t.clock.set('2026-12-05T10:00');
  let r = await t.get('/api/expenses/by-category?period=2026-11');
  assert.equal(r.body.data.total_cents, 33_000_000);
  r = await t.get('/api/balance?period=2026-11');
  assert.equal(r.body.data.formatted.balance, '$2.770.000');
  r = await t.get('/api/expenses');
  assert.equal(r.body.data.count, 0);
});

test('contexto para la IA', async () => {
  const t = await seeded();
  const r = await t.get('/api/context');
  const d = r.body.data;
  assert.equal(d.today, '2026-11-24');
  assert.equal(d.period_label, 'noviembre de 2026');
  assert.equal(d.pending_bills.items.length, 1);
  assert.equal(d.pending_bills.total, '$200.000');
  assert.equal(d.balance.formatted.balance, '$2.770.000');
  assert.equal(d.latest_closure, null);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestApp } from '../helpers/setup.js';

const pending = async (t) => (await t.get('/api/notifications/pending')).body.data.items;

test('gastos extras: CRUD, categoría opcional y fechas futuras rechazadas', async () => {
  const t = createTestApp();
  let r = await t.post('/api/expenses', { name: 'Cena', amount: '45.000', category: 'comida' });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.expense.category_label, 'Comida');
  const id = r.body.data.expense.id;

  r = await t.post('/api/expenses', { name: 'Regalo', amount: '20.000' });
  assert.equal(r.body.data.expense.category, null);

  r = await t.post('/api/expenses', { name: 'x', amount: '1', category: 'otra' });
  assert.equal(r.status, 400);

  r = await t.post('/api/expenses', { name: 'x', amount: '1', date: '2026-11-25' });
  assert.equal(r.status, 400);

  r = await t.patch(`/api/expenses/${id}`, { category: null, amount: '50.000' });
  assert.equal(r.body.data.expense.category, null);
  assert.equal(r.body.data.expense.amount_cents, 5_000_000);

  r = await t.del(`/api/expenses/${id}`);
  assert.equal(r.body.data.deleted, true);
  r = await t.get('/api/expenses');
  assert.equal(r.body.data.count, 1);
});

test('avisos del 80 % y 100 %: uno por umbral, sin repetir', async () => {
  const t = createTestApp();
  await t.put('/api/limits/monthly', { amount: '600.000' });

  let r = await t.post('/api/expenses', { name: 'a', amount_cents: 47_999_999 }); // $479.999,99 → 79,9 %
  assert.deepEqual(r.body.data.alerts, []);

  r = await t.post('/api/expenses', { name: 'b', amount_cents: 1 }); // exactamente $480.000
  assert.equal(r.body.data.alerts[0].type, 'limite_80');

  r = await t.post('/api/expenses', { name: 'c', amount: '10.000' });
  assert.deepEqual(r.body.data.alerts, []);

  r = await t.post('/api/expenses', { name: 'd', amount: '110.000' }); // $600.000 = 100 %
  assert.equal(r.body.data.alerts[0].type, 'limite_100');
  assert.equal(r.body.data.limit.percent, 100);

  r = await t.post('/api/expenses', { name: 'e', amount: '6.000' }); // 101 %
  assert.deepEqual(r.body.data.alerts, []);

  // Borrar no rearma el aviso.
  await t.del(`/api/expenses/${r.body.data.expense.id}`);
  r = await t.post('/api/expenses', { name: 'f', amount: '6.000' });
  assert.deepEqual(r.body.data.alerts, []);

  const items = await pending(t);
  assert.deepEqual(items.map((n) => n.type), ['limite_80', 'limite_100']);
});

test('cruzar ambos umbrales en una operación solo envía el del 100 %', async () => {
  const t = createTestApp();
  await t.put('/api/limits/monthly', { amount: '600.000' });
  const r = await t.post('/api/expenses', { name: 'TV', amount: '700.000', category: 'lujo' });
  assert.deepEqual(r.body.data.alerts.map((a) => a.type), ['limite_100']);
  const status = (await t.get('/api/limits/current')).body.data;
  assert.equal(status.alert_80_sent, true);
  assert.equal(status.alert_100_sent, true);
  assert.equal((await pending(t)).length, 1);
});

test('cambiar el límite limpia marcas o encola avisos', async () => {
  const t = createTestApp();
  await t.put('/api/limits/monthly', { amount: '600.000' });
  await t.post('/api/expenses', { name: 'a', amount: '500.000' }); // 80 %

  // Subir el límite deja el acumulado por debajo del 80 % → se limpia la marca.
  let r = await t.put('/api/limits/monthly', { amount: '1.000.000' });
  assert.equal(r.body.data.alert_80_sent, false);

  // Bajarlo por debajo del acumulado → aviso del 100 % inmediato.
  r = await t.put('/api/limits/monthly', { amount: '400.000' });
  assert.deepEqual(r.body.data.alerts.map((a) => a.type), ['limite_100']);
  assert.equal(r.body.data.alert_80_sent, true);

  r = await t.put('/api/limits/monthly', { amount: '0' });
  assert.equal(r.status, 400);
});

test('el límite se copia al mes nuevo', async () => {
  const t = createTestApp();
  await t.put('/api/limits/monthly', { amount: '600.000' });
  t.clock.set('2026-12-03T10:00');
  const r = await t.get('/api/limits/current');
  assert.equal(r.body.data.period, '2026-12');
  assert.equal(r.body.data.limit_cents, 60_000_000);
  assert.equal(r.body.data.alert_80_sent, false);
});

test('outbox: ack marca entregada y 404 si no existe', async () => {
  const t = createTestApp();
  await t.put('/api/limits/monthly', { amount: '100.000' });
  await t.post('/api/expenses', { name: 'a', amount: '100.000' });
  const [n] = await pending(t);
  let r = await t.post(`/api/notifications/${n.id}/ack`);
  assert.ok(r.body.data.delivered_at);
  assert.equal((await pending(t)).length, 0);
  r = await t.post('/api/notifications/999/ack');
  assert.equal(r.status, 404);
});

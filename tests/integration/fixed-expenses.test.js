import assert from 'node:assert/strict';
import test from 'node:test';

import { createTestApp } from '../helpers/setup.js';

test('crear plantilla genera la factura pendiente del periodo activo', async () => {
  const t = createTestApp();
  let r = await t.post('/api/fixed-expenses', { name: 'Arriendo', amount: '900.000', due_day: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.instance.paid, false);
  assert.equal(r.body.data.instance.overdue, true);

  r = await t.post('/api/fixed-expenses', { name: 'Gimnasio', amount: '100.000', due_day: 31 });
  assert.equal(r.body.data.instance.due_date, '2026-11-30');

  r = await t.get('/api/fixed-expenses/instances?status=pending');
  assert.equal(r.body.data.count, 2);
});

test('pagar una factura descuenta del saldo y no se paga dos veces', async () => {
  const t = createTestApp();
  await t.put('/api/salary', { amount: '3.500.000' });
  let r = await t.post('/api/fixed-expenses', { name: 'Arriendo', amount: '900.000', due_day: 1 });
  const instanceId = r.body.data.instance.id;

  r = await t.post(`/api/fixed-expenses/instances/${instanceId}/pay`);
  assert.equal(r.status, 200);
  assert.equal(r.body.data.paid, true);
  assert.equal(r.body.data.instance.paid_at, '2026-11-24');
  assert.equal(r.body.data.balance.formatted.balance, '$2.600.000');

  r = await t.post(`/api/fixed-expenses/instances/${instanceId}/pay`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'ALREADY_PAID');

  r = await t.post('/api/fixed-expenses/instances/999/pay');
  assert.equal(r.status, 404);

  r = await t.get('/api/fixed-expenses/instances?status=paid');
  assert.equal(r.body.data.count, 1);
});

test('editar propaga solo a la factura pendiente; borrar conserva las pagadas', async () => {
  const t = createTestApp();
  let r = await t.post('/api/fixed-expenses', { name: 'Internet', amount: '100.000', due_day: 5 });
  const id = r.body.data.template.id;

  r = await t.patch(`/api/fixed-expenses/${id}`, { amount: '120.000', due_day: 31 });
  assert.equal(r.body.data.active_instance_updated, true);
  r = await t.get('/api/fixed-expenses/instances');
  assert.equal(r.body.data.items[0].amount_cents, 12_000_000);
  assert.equal(r.body.data.items[0].due_date, '2026-11-30');

  await t.post(`/api/fixed-expenses/instances/${r.body.data.items[0].id}/pay`);
  r = await t.patch(`/api/fixed-expenses/${id}`, { amount: '150.000', name: 'Fibra' });
  assert.equal(r.body.data.active_instance_updated, false);
  r = await t.get('/api/fixed-expenses/instances');
  assert.equal(r.body.data.items[0].amount_cents, 12_000_000);
  assert.equal(r.body.data.items[0].name, 'Internet');

  r = await t.del(`/api/fixed-expenses/${id}`);
  assert.equal(r.body.data.deleted, true);
  r = await t.get('/api/fixed-expenses/instances');
  assert.equal(r.body.data.count, 1);
  assert.equal(r.body.data.items[0].fixed_expense_id, null);
  assert.equal(r.body.data.items[0].paid, true);

  r = await t.get('/api/fixed-expenses');
  assert.equal(r.body.data.items.length, 0);
});

test('borrar plantilla elimina su factura pendiente', async () => {
  const t = createTestApp();
  let r = await t.post('/api/fixed-expenses', { name: 'Crédito', amount: '200.000', due_day: 10 });
  r = await t.del(`/api/fixed-expenses/${r.body.data.template.id}`);
  assert.equal(r.body.data.pending_instances_removed, 1);
  r = await t.get('/api/fixed-expenses/instances');
  assert.equal(r.body.data.count, 0);
});

test('las facturas del mes siguiente nacen pendientes', async () => {
  const t = createTestApp();
  let r = await t.post('/api/fixed-expenses', { name: 'Arriendo', amount: '900.000', due_day: 31 });
  await t.post(`/api/fixed-expenses/instances/${r.body.data.instance.id}/pay`);

  t.clock.set('2027-02-01T08:00'); // cierra nov, dic y ene en orden
  r = await t.get('/api/fixed-expenses/instances');
  assert.equal(r.body.data.period, '2027-02');
  assert.equal(r.body.data.items[0].paid, false);
  assert.equal(r.body.data.items[0].due_date, '2027-02-28');

  r = await t.get('/api/fixed-expenses/instances?period=2026-12');
  assert.equal(r.body.data.items[0].paid, false);
  assert.equal(r.body.data.items[0].due_date, '2026-12-31');
});

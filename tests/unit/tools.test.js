import assert from 'node:assert/strict';
import test from 'node:test';

import { executeTool, MAX_LIST_ITEMS, toolDefinitions, TOOLS, trimLists } from '../../src/ai/tools.js';

/** API falsa que registra la llamada en vez de hacer HTTP. */
function recorder() {
  const calls = [];
  const make = (method) => async (path, arg) => {
    calls.push({ method, path, arg });
    return { ok: true, data: {} };
  };
  return { calls, api: { get: make('GET'), post: make('POST'), put: make('PUT'), patch: make('PATCH'), delete: make('DELETE') } };
}

test('el catálogo cubre las 19 herramientas de AGENTS.md §10.3', () => {
  const defs = toolDefinitions();
  assert.equal(defs.length, 19);
  for (const def of defs) {
    assert.equal(def.type, 'function');
    assert.equal(def.function.parameters.type, 'object');
    assert.equal('$schema' in def.function.parameters, false);
  }
  const gasto = defs.find((d) => d.function.name === 'registrar_gasto_extra').function.parameters;
  assert.deepEqual(gasto.required.sort(), ['monto', 'nombre']);
});

test('matriz herramienta → endpoint', async () => {
  const cases = [
    ['consultar_contexto', {}, 'GET', '/api/context'],
    ['consultar_saldo', { periodo: '2026-10' }, 'GET', '/api/balance', { period: '2026-10' }],
    ['configurar_salario', { monto: '3.500.000', dia_pago: 10 }, 'PUT', '/api/salary', { amount: '3.500.000', pay_day: 10 }],
    ['registrar_ingreso_extra', { descripcion: 'Venta', monto: 5000 }, 'POST', '/api/incomes', { description: 'Venta', amount: 5000 }],
    ['editar_ingreso_extra', { id: 3, monto: '1' }, 'PATCH', '/api/incomes/3', { amount: '1' }],
    ['eliminar_ingreso_extra', { id: 3 }, 'DELETE', '/api/incomes/3'],
    ['crear_gasto_fijo', { nombre: 'Arriendo', monto: '900.000', dia_pago: 1 }, 'POST', '/api/fixed-expenses', { name: 'Arriendo', amount: '900.000', due_day: 1 }],
    ['editar_gasto_fijo', { id: 2, dia_pago: 5 }, 'PATCH', '/api/fixed-expenses/2', { due_day: 5 }],
    ['eliminar_gasto_fijo', { id: 2 }, 'DELETE', '/api/fixed-expenses/2'],
    ['consultar_facturas', { estado: 'pendientes' }, 'GET', '/api/fixed-expenses/instances', { status: 'pending', period: undefined }],
    ['pagar_factura', { factura_id: 12 }, 'POST', '/api/fixed-expenses/instances/12/pay'],
    ['registrar_gasto_extra', { nombre: 'Cena', monto: '45.000', categoria: 'comida' }, 'POST', '/api/expenses', { name: 'Cena', amount: '45.000', category: 'comida' }],
    ['editar_gasto_extra', { id: 7, categoria: 'sin_categoria' }, 'PATCH', '/api/expenses/7', { category: null }],
    ['eliminar_gasto_extra', { id: 7 }, 'DELETE', '/api/expenses/7'],
    ['consultar_gastos', { vista: 'recientes' }, 'GET', '/api/expenses/recent', { limit: 10 }],
    ['consultar_gastos', { vista: 'por_dias' }, 'GET', '/api/expenses/by-day', { days: 3 }],
    ['consultar_gastos', { vista: 'por_categoria' }, 'GET', '/api/expenses/by-category', { period: undefined }],
    ['consultar_gastos', { vista: 'por_monto', categoria: 'lujo' }, 'GET', '/api/expenses', { sort: 'amount', order: 'desc', period: undefined, from: undefined, to: undefined, category: 'lujo', limit: 20 }],
    ['consultar_gastos', { vista: 'por_monto', orden: 'asc', desde: '2026-11-24', hasta: '2026-11-24' }, 'GET', '/api/expenses', { sort: 'amount', order: 'asc', period: undefined, from: '2026-11-24', to: '2026-11-24', category: undefined, limit: 20 }],
    ['definir_limite_mensual', { monto: '600.000' }, 'PUT', '/api/limits/monthly', { amount: '600.000' }],
    ['consultar_limite', {}, 'GET', '/api/limits/current'],
    ['consultar_ahorro', {}, 'GET', '/api/savings'],
    ['consultar_cierre_mensual', {}, 'GET', '/api/closures/latest'],
    ['consultar_cierre_mensual', { periodo: '2026-10' }, 'GET', '/api/closures/2026-10']
  ];
  const covered = new Set();
  for (const [name, args, method, path, arg] of cases) {
    const { calls, api } = recorder();
    const result = await executeTool(name, JSON.stringify(args), api);
    assert.equal(result.ok, true, name);
    assert.equal(calls.length, 1, name);
    assert.equal(calls[0].method, method, name);
    assert.equal(calls[0].path, path, name);
    if (arg !== undefined) assert.deepEqual(calls[0].arg, arg, name);
    covered.add(name);
  }
  assert.equal(covered.size, TOOLS.length);
});

test('argumentos inválidos no llegan al backend', async () => {
  const { calls, api } = recorder();
  let r = await executeTool('registrar_gasto_extra', { nombre: 'x', categoria: 'otra' }, api);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'VALIDATION_ERROR');
  assert.ok(r.error.details.length >= 1);

  r = await executeTool('pagar_factura', '{no es json', api);
  assert.equal(r.error.code, 'VALIDATION_ERROR');

  r = await executeTool('borrar_todo', {}, api);
  assert.equal(r.error.code, 'UNKNOWN_TOOL');
  assert.equal(calls.length, 0);
});

test('recorta las listas a 20 elementos', () => {
  const trimmed = trimLists({ data: { items: Array.from({ length: 50 }, (_, i) => ({ i, tags: [1, 2] })) } });
  assert.equal(trimmed.data.items.length, MAX_LIST_ITEMS);
  assert.deepEqual(trimmed.data.items[0], { i: 0, tags: [1, 2] });
});

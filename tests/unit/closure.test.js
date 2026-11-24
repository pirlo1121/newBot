import assert from 'node:assert/strict';
import test from 'node:test';

import { closureReportText, computeClosure, percentOf, rankCategories } from '../../src/domain/closure.js';

const totals = (pairs) => pairs.map(([category, total_cents]) => ({ category, total_cents }));

test('ranking: mayor total primero y nombre como desempate', () => {
  const r = rankCategories(totals([['lujo', 100], ['comida', 300], ['salidas', 100]]));
  assert.equal(r.top, 'comida');
  assert.equal(r.bottom, 'salidas'); // lujo y salidas empatan: gana "lujo" por nombre, salidas queda al final
});

test('una sola categoría deja la menor en null; sin gastos, ambas null', () => {
  assert.deepEqual(
    [rankCategories(totals([['comida', 5]])).top, rankCategories(totals([['comida', 5]])).bottom],
    ['comida', null]
  );
  const empty = rankCategories([]);
  assert.equal(empty.top, null);
  assert.equal(empty.bottom, null);
});

test('computeClosure calcula saldo, ahorro y desglose', () => {
  const c = computeClosure({
    salaryCents: 350_000_000, // $3.500.000
    extraIncomeCents: 50_000_000, // $500.000
    fixedPaidCents: 110_000_000, // $1.100.000
    categoryTotals: totals([['comida', 30_000_000], ['sin_categoria', 15_000_000]])
  });
  assert.equal(c.extraExpenseCents, 45_000_000);
  assert.equal(c.balanceCents, 245_000_000);
  assert.equal(c.savedCents, 245_000_000);
  assert.equal(c.deficitCents, 0);
  assert.equal(c.topCategory, 'comida');
  assert.equal(c.bottomCategory, 'sin_categoria');
  assert.equal(c.breakdown[0].percent, 66.7);
});

test('saldo negativo genera déficit y ahorro cero', () => {
  const c = computeClosure({
    salaryCents: 100,
    extraIncomeCents: 0,
    fixedPaidCents: 150,
    categoryTotals: []
  });
  assert.equal(c.balanceCents, -50);
  assert.equal(c.savedCents, 0);
  assert.equal(c.deficitCents, 50);
  const text = closureReportText({ period: '2026-11', closure: c, savingsBalanceCents: 0, salaryMissing: false });
  assert.match(text, /Déficit del mes/);
});

test('percentOf redondea a un decimal y tolera total cero', () => {
  assert.equal(percentOf(1, 3), 33.3);
  assert.equal(percentOf(5, 0), 0);
});

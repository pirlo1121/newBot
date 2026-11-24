import assert from 'node:assert/strict';
import test from 'node:test';

import { amountFromBody, assertAmount, formatCop, MAX_CENTS, parseCop } from '../../src/domain/money.js';

test('parseCop interpreta la tabla de AGENTS.md §8.1', () => {
  const cases = [
    ['900.000', 90_000_000], // $900.000
    ['900000', 90_000_000],
    ['$ 1.250.500', 125_050_000],
    ['900.000,50', 90_000_050],
    ['900000.50', 90_000_050],
    ['900000,5', 90_000_050],
    ['1.5', 150],
    ['COP 45.000', 4_500_000],
    [45000, 4_500_000],
    [12.5, 1_250]
  ];
  for (const [input, cents] of cases) {
    assert.equal(parseCop(input), cents, `entrada ${JSON.stringify(input)}`);
  }
});

test('parseCop rechaza ceros, negativos, decimales de más, basura y exceso', () => {
  for (const input of ['0', '0,00', '-5000', '10.123,456', '12.34.5', 'abc', '', '1,2,3', -1, 0, null, undefined, NaN]) {
    assert.throws(() => parseCop(input), { code: 'VALIDATION_ERROR' }, `entrada ${JSON.stringify(input)}`);
  }
  assert.throws(() => parseCop('10.000.000.001'), /máximo/);
  assert.equal(parseCop('10.000.000.000'), MAX_CENTS);
});

test('assertAmount exige enteros positivos dentro del máximo', () => {
  assert.equal(assertAmount(1), 1);
  assert.throws(() => assertAmount(1.5), /entero/);
  assert.throws(() => assertAmount(0), /mayor que cero/);
  assert.throws(() => assertAmount(MAX_CENTS + 1), /máximo/);
});

test('formatCop usa es-CO sin decimales salvo que existan centavos', () => {
  assert.equal(formatCop(350_000_000), '$3.500.000');
  assert.equal(formatCop(0), '$0');
  assert.equal(formatCop(90_000_050), '$900.000,50');
  assert.equal(formatCop(-200_000), '-$2.000');
});

test('amountFromBody prefiere amount_cents sobre amount', () => {
  assert.equal(amountFromBody({ amount_cents: 100, amount: '5' }), 100);
  assert.equal(amountFromBody({ amount: '5' }), 500);
  assert.equal(amountFromBody({}), undefined);
});

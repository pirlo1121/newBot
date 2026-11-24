import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDays, clampDay, closureTriggerDate, isValidDate, nextPeriod, nextSalaryDate,
  periodLabel, periodRange, previousPeriod, todayInTz
} from '../../src/domain/dates.js';

test('clampDay ajusta al último día del mes', () => {
  assert.equal(clampDay('2026-02', 31), '2026-02-28');
  assert.equal(clampDay('2028-02', 31), '2028-02-29');
  assert.equal(clampDay('2028-02', 29), '2028-02-29');
  assert.equal(clampDay('2026-04', 31), '2026-04-30');
  assert.equal(clampDay('2026-01', 5), '2026-01-05');
});

test('cambio de mes y de año', () => {
  assert.equal(nextPeriod('2026-12'), '2027-01');
  assert.equal(previousPeriod('2027-01'), '2026-12');
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.deepEqual(periodRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' });
});

test('todayInTz usa la hora de Bogotá', () => {
  // 23:59 del 30 de noviembre en Bogotá = 04:59 UTC del 1 de diciembre.
  assert.equal(todayInTz(new Date('2026-12-01T04:59:00Z'), 'America/Bogota'), '2026-11-30');
  assert.equal(todayInTz(new Date('2026-12-01T05:00:00Z'), 'America/Bogota'), '2026-12-01');
});

test('próxima fecha de pago y disparador del cierre', () => {
  assert.equal(nextSalaryDate('2026-11-24', 1), '2026-12-01');
  assert.equal(nextSalaryDate('2026-11-10', 10), '2026-11-10');
  assert.equal(nextSalaryDate('2026-01-31', 31), '2026-01-31');
  assert.equal(nextSalaryDate('2026-02-01', 31), '2026-02-28');
  assert.equal(closureTriggerDate('2026-11', 10), '2026-12-10');
  assert.equal(closureTriggerDate('2026-01', 31), '2026-02-28');
  assert.equal(closureTriggerDate('2026-12', 1), '2027-01-01');
});

test('validación de fechas y etiquetas', () => {
  assert.equal(isValidDate('2026-02-29'), false);
  assert.equal(isValidDate('2028-02-29'), true);
  assert.equal(isValidDate('2026-13-01'), false);
  assert.equal(isValidDate('2026-1-01'), false);
  assert.equal(periodLabel('2026-11'), 'noviembre de 2026');
});

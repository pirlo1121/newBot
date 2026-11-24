import assert from 'node:assert/strict';
import test from 'node:test';

import { claimsWrite, reviewAnswer } from '../../src/ai/guard.js';

// Respuestas reales del incidente del 2026-11-24: afirmaban cambios que no se guardaron.
const FALSE_CLAIMS = [
  'Límite mensual de gastos extras definido en $450.000.',
  'Marqué como pagadas grok $110.000, claude $75.000 y paramount $25.000.',
  'Registré los tres:\n\nuber $20.000 (transporte, 24 nov)',
  'Registrado: Cena por $45.000 en categoría Comida',
  'Listo, quedó configurado tu salario en $3.500.000.',
  'Ya quedaron pagadas las tres facturas.',
  'Pagué la factura de hbo.',
  'Eliminé el gasto del taxi.'
];

// Respuestas legítimas sin escritura: preguntas, confirmaciones y consultas.
const NOT_CLAIMS = [
  'Interpreto así: 1. uber $20.000 (transporte). ¿Los registro?',
  '¿En qué categoría va Valentina, "salidas" o "lujo"?',
  'Quedan pendientes las 4 de streaming: hbo $12.000.',
  'Facturas pagadas este mes: arriendo $1.000.000.',
  'Confírmame y registro los tres.',
  '¿Quieres que lo registre como gasto de hoy?',
  'No pude registrar el gasto: el monto no es válido.'
];

test('detecta afirmaciones de cambios', () => {
  for (const text of FALSE_CLAIMS) assert.equal(claimsWrite(text), true, text);
  for (const text of NOT_CLAIMS) assert.equal(claimsWrite(text), false, text);
});

test('reviewAnswer exige una escritura exitosa en el turno', () => {
  const text = 'Registré los tres gastos.';
  assert.equal(reviewAnswer({ text, toolCalls: [] }), 'claim');
  assert.equal(reviewAnswer({ text, toolCalls: [{ name: 'consultar_gastos', ok: true }] }), 'claim');
  assert.equal(reviewAnswer({ text, toolCalls: [{ name: 'registrar_gasto_extra', ok: false }] }), 'claim');
  assert.equal(reviewAnswer({ text, toolCalls: [{ name: 'registrar_gasto_extra', ok: true }] }), 'ok');
});

test('reviewAnswer exige consultar antes de dar cifras, salvo preguntas', () => {
  assert.equal(reviewAnswer({ text: 'Tus gastos de hoy: uber $20.000.', toolCalls: [] }), 'data');
  assert.equal(reviewAnswer({ text: 'Tus gastos de hoy: uber $20.000.', toolCalls: [{ name: 'consultar_gastos', ok: true }] }), 'ok');
  assert.equal(reviewAnswer({ text: 'Interpreto $20.000 para el uber, ¿correcto?', toolCalls: [] }), 'ok');
  assert.equal(reviewAnswer({ text: '¡De nada! Aquí estoy.', toolCalls: [] }), 'ok');
});

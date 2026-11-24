import { validationError } from '../errors.js';

/** Máximo permitido: $10.000 millones (RN-19). */
export const MAX_CENTS = 1_000_000_000_000;

const thousandsPattern = /^\d{1,3}(\.\d{3})+$/;
const plainPattern = /^\d+$/;
const decimalPointPattern = /^(\d+)\.(\d{1,2})$/;
const commaPattern = /^(\d{1,3}(?:\.\d{3})+|\d+),(\d{1,2})$/;

function toCents(integerPart, fractionPart = '') {
  const cents = BigInt(integerPart) * 100n + BigInt((fractionPart + '00').slice(0, 2));
  if (cents > BigInt(MAX_CENTS)) {
    throw validationError('El monto supera el máximo permitido ($10.000.000.000).');
  }
  return Number(cents);
}

/**
 * Convierte un monto en pesos (texto o número) a centavos enteros.
 * Reglas en AGENTS.md §8.1: punto de miles, coma decimal y punto decimal
 * cuando no forma grupos de tres.
 */
export function parseCop(input) {
  let text;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw validationError('El monto no es un número válido.');
    text = String(input);
    if (/e/i.test(text)) throw validationError('El monto no es un número válido.');
  } else if (typeof input === 'string') {
    text = input;
  } else {
    throw validationError('El monto es obligatorio.');
  }

  text = text.replace(/cop/gi, '').replace(/[$\s ]/g, '');

  if (text.startsWith('-')) throw validationError('El monto debe ser mayor que cero.');
  if (text === '') throw validationError('El monto es obligatorio.');

  let cents;
  let match;
  if (plainPattern.test(text)) {
    cents = toCents(text);
  } else if (thousandsPattern.test(text)) {
    cents = toCents(text.replaceAll('.', ''));
  } else if ((match = decimalPointPattern.exec(text))) {
    cents = toCents(match[1], match[2]);
  } else if ((match = commaPattern.exec(text))) {
    cents = toCents(match[1].replaceAll('.', ''), match[2]);
  } else {
    throw validationError(
      `No entendí el monto "${String(input)}". Usa un formato como 900000 o 900.000 (máximo dos decimales).`
    );
  }

  return assertAmount(cents);
}

/** Valida un monto ya expresado en centavos. */
export function assertAmount(cents) {
  if (!Number.isSafeInteger(cents)) throw validationError('El monto en centavos debe ser un entero.');
  if (cents <= 0) throw validationError('El monto debe ser mayor que cero.');
  if (cents > MAX_CENTS) throw validationError('El monto supera el máximo permitido ($10.000.000.000).');
  return cents;
}

const wholeFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
});
const centsFormatter = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

/** Formatea centavos como pesos colombianos: 350000000 → "$3.500.000". */
export function formatCop(cents) {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const pesos = Math.trunc(abs / 100);
  const rest = abs % 100;
  const text =
    rest === 0
      ? wholeFormatter.format(pesos)
      : centsFormatter.format(Number(`${pesos}.${String(rest).padStart(2, '0')}`));
  const clean = text.replace(/[\s ]/g, '');
  return negative ? `-${clean}` : clean;
}

/**
 * Lee `amount_cents` (gana si viene) o `amount` (pesos) de un body.
 * Devuelve undefined si no viene ninguno.
 */
export function amountFromBody(body) {
  if (body.amount_cents !== undefined && body.amount_cents !== null) {
    return assertAmount(body.amount_cents);
  }
  if (body.amount !== undefined && body.amount !== null) {
    return parseCop(body.amount);
  }
  return undefined;
}

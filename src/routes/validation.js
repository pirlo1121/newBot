import { z } from 'zod';

import { isValidDate, isValidPeriod } from '../domain/dates.js';
import { validationError } from '../errors.js';

z.config(z.locales.es());

/** Valida con zod y lanza VALIDATION_ERROR con detalles en español. */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || null,
    message: issue.message
  }));
  const first = details[0];
  throw validationError(first.field ? `${first.field}: ${first.message}` : first.message, details);
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const dateField = z.string().refine(isValidDate, 'Debe ser una fecha válida YYYY-MM-DD');
export const periodField = z.string().refine(isValidPeriod, 'Debe ser un periodo válido YYYY-MM');

export const amountFields = {
  amount_cents: z.number().int().optional(),
  amount: z.union([z.string(), z.number()]).optional()
};

export const paging = {
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0)
};

export const text = (max = 120) => z.string().trim().min(1).max(max);

export { z };

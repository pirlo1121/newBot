/**
 * Error de negocio con código estable y mensaje en español.
 * El manejador central lo traduce al envelope de la API.
 */
export class AppError extends Error {
  constructor(code, message, status = 400, details = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const validationError = (message, details = []) =>
  new AppError('VALIDATION_ERROR', message, 400, details);

export const notFound = (message = 'No se encontró el recurso.') =>
  new AppError('NOT_FOUND', message, 404);

export const periodClosed = (period) =>
  new AppError(
    'PERIOD_CLOSED',
    `El periodo ${period} está cerrado; no se pueden crear, editar ni eliminar movimientos en él.`,
    409
  );

export const alreadyPaid = () =>
  new AppError('ALREADY_PAID', 'Esa factura ya está pagada este mes.', 409);

export const conflict = (message) => new AppError('CONFLICT', message, 409);

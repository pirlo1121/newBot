export function notFoundHandler(req, res) {
  res.status(404).json({
    ok: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Ruta no encontrada.',
      details: []
    }
  });
}

/**
 * Traduce errores de Express y de negocio al envelope de la API.
 * Los errores 500 no exponen detalles internos y se reportan a `onServerError`.
 */
export function errorHandler({ onServerError } = {}) {
  return function errorHandlerMiddleware(err, req, res, next) {
    if (res.headersSent) {
      next(err);
      return;
    }

    const isBadJson = err instanceof SyntaxError && err.status === 400 && 'body' in err;
    const isTooLarge = err.type === 'entity.too.large';
    const status = isBadJson ? 400 : Number.isInteger(err.status) ? err.status : 500;
    const code = isBadJson || isTooLarge
      ? 'VALIDATION_ERROR'
      : err.code && typeof err.code === 'string' && /^[A-Z_]+$/.test(err.code) && status < 500
        ? err.code
        : status >= 500
          ? 'INTERNAL_ERROR'
          : 'ERROR';
    const message = isBadJson
      ? 'El cuerpo de la petición no es JSON válido.'
      : isTooLarge
        ? 'El cuerpo de la petición es demasiado grande.'
        : status >= 500
          ? 'Ocurrió un error interno.'
          : err.message;

    if (status >= 500) {
      req.log?.error({ err }, 'error no controlado');
      try {
        onServerError?.(err, req);
      } catch {
        // El aviso al dueño nunca debe tumbar la respuesta.
      }
    }

    res.status(status).json({
      ok: false,
      error: {
        code,
        message,
        details: Array.isArray(err.details) ? err.details : []
      }
    });
  };
}

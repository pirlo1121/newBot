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
 * Los errores 500 no exponen detalles internos.
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }

  const isBadJson = err instanceof SyntaxError && err.status === 400 && 'body' in err;
  const status = isBadJson ? 400 : Number.isInteger(err.status) ? err.status : 500;
  const code = isBadJson
    ? 'VALIDATION_ERROR'
    : err.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'ERROR');
  const message = isBadJson
    ? 'El cuerpo de la petición no es JSON válido.'
    : status >= 500
      ? 'Ocurrió un error interno.'
      : err.message;

  if (status >= 500) {
    req.log?.error({ err }, 'error no controlado');
  }

  res.status(status).json({
    ok: false,
    error: {
      code,
      message,
      details: Array.isArray(err.details) ? err.details : []
    }
  });
}

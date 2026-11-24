import { z } from 'zod';

import { CATEGORIES, UNCATEGORIZED } from '../domain/categories.js';

z.config(z.locales.es());

export const MAX_LIST_ITEMS = 20;

const monto = z
  .union([z.string().min(1), z.number().positive()])
  .describe('Monto en pesos colombianos ya confirmado por el usuario, p. ej. "45000" o "45.000".');
const fecha = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('Fecha YYYY-MM-DD resuelta con meta.today. Omítela para usar hoy.');
const periodo = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe('Mes YYYY-MM. Omítelo para el mes actual.');
const id = (what) => z.number().int().positive().describe(`ID ${what}, tomado de una consulta previa.`);
const categoria = z.enum(CATEGORIES).describe('Categoría del gasto. Omítela si el usuario no la menciona.');
const categoriaFiltro = z.enum([...CATEGORIES, UNCATEGORIZED]);

const drop = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

/**
 * Catálogo de AGENTS.md §10.3. Cada herramienta valida sus argumentos con zod
 * y traduce del español al contrato HTTP en inglés.
 */
export const TOOLS = [
  {
    name: 'consultar_contexto',
    description: 'Resumen actual: fecha de hoy, mes activo, salario, límite, saldo, ahorro, facturas pendientes y último cierre.',
    schema: z.object({}),
    run: (_, api) => api.get('/api/context')
  },
  {
    name: 'consultar_saldo',
    description: 'Saldo del mes con desglose: salario + ingresos extras − gastos fijos pagados − gastos extras.',
    schema: z.object({ periodo: periodo.optional() }),
    run: (a, api) => api.get('/api/balance', { period: a.periodo })
  },
  {
    name: 'configurar_salario',
    description: 'Crea o cambia el salario mensual. Requiere confirmación explícita del usuario.',
    schema: z.object({
      monto,
      dia_pago: z.number().int().min(1).max(31).optional().describe('Día del mes en que llega el salario (1–31).')
    }),
    run: (a, api) => api.put('/api/salary', drop({ amount: a.monto, pay_day: a.dia_pago }))
  },
  {
    name: 'registrar_ingreso_extra',
    description: 'Registra un ingreso adicional (venta, negocio, etc.).',
    schema: z.object({ descripcion: z.string().min(1).max(200), monto, fecha: fecha.optional() }),
    run: (a, api) => api.post('/api/incomes', drop({ description: a.descripcion, amount: a.monto, date: a.fecha }))
  },
  {
    name: 'editar_ingreso_extra',
    description: 'Edita un ingreso extra existente. Solo envía los campos que cambian.',
    schema: z.object({
      id: id('del ingreso'),
      descripcion: z.string().min(1).max(200).optional(),
      monto: monto.optional(),
      fecha: fecha.optional()
    }),
    run: (a, api) =>
      api.patch(`/api/incomes/${a.id}`, drop({ description: a.descripcion, amount: a.monto, date: a.fecha }))
  },
  {
    name: 'eliminar_ingreso_extra',
    description: 'Elimina un ingreso extra. Requiere confirmación explícita del usuario.',
    schema: z.object({ id: id('del ingreso') }),
    run: (a, api) => api.delete(`/api/incomes/${a.id}`)
  },
  {
    name: 'crear_gasto_fijo',
    description: 'Crea un gasto fijo mensual (arriendo, servicios, crédito) y su factura pendiente de este mes.',
    schema: z.object({
      nombre: z.string().min(1).max(120),
      monto,
      dia_pago: z.number().int().min(1).max(31).describe('Día del mes en que se paga (1–31).')
    }),
    run: (a, api) => api.post('/api/fixed-expenses', { name: a.nombre, amount: a.monto, due_day: a.dia_pago })
  },
  {
    name: 'editar_gasto_fijo',
    description: 'Edita la plantilla de un gasto fijo. La factura de este mes cambia solo si sigue pendiente.',
    schema: z.object({
      id: id('del gasto fijo (plantilla)'),
      nombre: z.string().min(1).max(120).optional(),
      monto: monto.optional(),
      dia_pago: z.number().int().min(1).max(31).optional()
    }),
    run: (a, api) =>
      api.patch(`/api/fixed-expenses/${a.id}`, drop({ name: a.nombre, amount: a.monto, due_day: a.dia_pago }))
  },
  {
    name: 'eliminar_gasto_fijo',
    description: 'Elimina un gasto fijo y sus facturas pendientes; las pagadas se conservan. Requiere confirmación.',
    schema: z.object({ id: id('del gasto fijo (plantilla)') }),
    run: (a, api) => api.delete(`/api/fixed-expenses/${a.id}`)
  },
  {
    name: 'consultar_facturas',
    description: 'Facturas de gastos fijos del mes con su estado, fecha límite y si están vencidas.',
    schema: z.object({
      estado: z.enum(['pendientes', 'pagadas', 'todas']).default('todas'),
      periodo: periodo.optional()
    }),
    run: (a, api) =>
      api.get('/api/fixed-expenses/instances', {
        status: { pendientes: 'pending', pagadas: 'paid', todas: 'all' }[a.estado],
        period: a.periodo
      })
  },
  {
    name: 'pagar_factura',
    description: 'Marca como pagada una factura (instancia mensual de un gasto fijo). Requiere confirmación.',
    schema: z.object({ factura_id: id('de la factura') }),
    run: (a, api) => api.post(`/api/fixed-expenses/instances/${a.factura_id}/pay`)
  },
  {
    name: 'registrar_gasto_extra',
    description: 'Registra un gasto variable. Devuelve avisos de límite si se cruzó el 80 % o el 100 %.',
    schema: z.object({
      nombre: z.string().min(1).max(120),
      monto,
      categoria: categoria.optional(),
      fecha: fecha.optional()
    }),
    run: (a, api) =>
      api.post('/api/expenses', drop({ name: a.nombre, amount: a.monto, category: a.categoria, date: a.fecha }))
  },
  {
    name: 'editar_gasto_extra',
    description: 'Edita un gasto extra. Usa categoria "sin_categoria" para quitarle la categoría.',
    schema: z.object({
      id: id('del gasto'),
      nombre: z.string().min(1).max(120).optional(),
      monto: monto.optional(),
      categoria: categoriaFiltro.optional(),
      fecha: fecha.optional()
    }),
    run: (a, api) =>
      api.patch(
        `/api/expenses/${a.id}`,
        drop({
          name: a.nombre,
          amount: a.monto,
          category: a.categoria === UNCATEGORIZED ? null : a.categoria,
          date: a.fecha
        })
      )
  },
  {
    name: 'eliminar_gasto_extra',
    description: 'Elimina un gasto extra. Requiere confirmación explícita del usuario.',
    schema: z.object({ id: id('del gasto') }),
    run: (a, api) => api.delete(`/api/expenses/${a.id}`)
  },
  {
    name: 'consultar_gastos',
    description:
      'Consulta gastos extras. vista: "recientes" (últimos registrados), "por_dias" (hoy y los N días anteriores), ' +
      '"por_categoria" (totales y porcentajes del mes), "por_monto" (de mayor a menor).',
    schema: z.object({
      vista: z.enum(['recientes', 'por_dias', 'por_categoria', 'por_monto']),
      dias: z.number().int().min(0).max(31).optional().describe('Para por_dias: días hacia atrás además de hoy (por defecto 3).'),
      periodo: periodo.optional(),
      categoria: categoriaFiltro.optional().describe('Para por_monto: filtra por categoría.'),
      limite: z.number().int().min(1).max(MAX_LIST_ITEMS).optional()
    }),
    run: (a, api) => {
      switch (a.vista) {
        case 'recientes':
          return api.get('/api/expenses/recent', { limit: a.limite ?? 10 });
        case 'por_dias':
          return api.get('/api/expenses/by-day', { days: a.dias ?? 3 });
        case 'por_categoria':
          return api.get('/api/expenses/by-category', { period: a.periodo });
        default:
          return api.get('/api/expenses', {
            sort: 'amount',
            order: 'desc',
            period: a.periodo,
            category: a.categoria,
            limit: a.limite ?? MAX_LIST_ITEMS
          });
      }
    }
  },
  {
    name: 'definir_limite_mensual',
    description: 'Define o cambia el límite mensual de gastos extras. Requiere confirmación.',
    schema: z.object({ monto }),
    run: (a, api) => api.put('/api/limits/monthly', { amount: a.monto })
  },
  {
    name: 'consultar_limite',
    description: 'Límite del mes, acumulado de gastos extras, porcentaje usado y avisos enviados.',
    schema: z.object({}),
    run: (_, api) => api.get('/api/limits/current')
  },
  {
    name: 'consultar_ahorro',
    description: 'Saldo del ahorro general acumulado por los cierres mensuales.',
    schema: z.object({}),
    run: (_, api) => api.get('/api/savings')
  },
  {
    name: 'consultar_cierre_mensual',
    description: 'Resumen de un cierre mensual (el último si no se indica el mes).',
    schema: z.object({ periodo: periodo.optional() }),
    run: (a, api) => (a.periodo ? api.get(`/api/closures/${a.periodo}`) : api.get('/api/closures/latest'))
  }
];

const byName = new Map(TOOLS.map((tool) => [tool.name, tool]));

/** Definiciones en formato de chat completions compatible con OpenAI. */
export function toolDefinitions() {
  return TOOLS.map((tool) => {
    const { $schema, ...parameters } = z.toJSONSchema(tool.schema, { io: 'input' });
    return {
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters }
    };
  });
}

/** Recorta listas a MAX_LIST_ITEMS: el modelo no necesita más para redactar. */
export function trimLists(value) {
  if (Array.isArray(value)) return value.slice(0, MAX_LIST_ITEMS).map(trimLists);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimLists(v)]));
  }
  return value;
}

/**
 * Ejecuta una herramienta. Argumentos inválidos se devuelven como error de
 * validación sin llamar al backend (§10.2).
 */
export async function executeTool(name, rawArgs, api) {
  const tool = byName.get(name);
  if (!tool) {
    return { ok: false, error: { code: 'UNKNOWN_TOOL', message: `La herramienta "${name}" no existe.` } };
  }

  let args = rawArgs;
  if (typeof rawArgs === 'string') {
    try {
      args = rawArgs.trim() ? JSON.parse(rawArgs) : {};
    } catch {
      return { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Los argumentos no son JSON válido.' } };
    }
  }

  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Argumentos inválidos para la herramienta.',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message }))
      }
    };
  }

  return trimLists(await tool.run(parsed.data, api));
}

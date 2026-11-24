/**
 * Verificación de la respuesta final del modelo contra lo que realmente
 * ejecutó el backend en el turno. Evita que el bot diga "registré" o
 * "pagué" sin que exista una escritura exitosa (incidente del 2026-11-24).
 */

/** Herramientas que modifican datos. */
export const WRITE_TOOLS = new Set([
  'configurar_salario',
  'registrar_ingreso_extra',
  'editar_ingreso_extra',
  'eliminar_ingreso_extra',
  'crear_gasto_fijo',
  'editar_gasto_fijo',
  'eliminar_gasto_fijo',
  'pagar_factura',
  'registrar_gasto_extra',
  'editar_gasto_extra',
  'eliminar_gasto_extra',
  'definir_limite_mensual'
]);

// Primera persona del pretérito ("registré", "pagué") o resultados ya hechos
// ("quedó registrado", "Registrado:", "límite definido en $450.000").
// Exige tilde para no confundir "registre" (subjuntivo) o "cree" (verbo creer).
const FIRST_PERSON = String.raw`registré|pagué|marqué|eliminé|borré|guardé|definí|configuré|actualicé|edité|cambié|anoté|agregué|añadí|creé|apliqué|ajusté|quité`;
const PARTICIPLE = String.raw`registrad[oa]s?|pagad[oa]s?|marcad[oa]s?|eliminad[oa]s?|borrad[oa]s?|guardad[oa]s?|definid[oa]s?|configurad[oa]s?|actualizad[oa]s?|editad[oa]s?|cambiad[oa]s?|anotad[oa]s?|agregad[oa]s?|cread[oa]s?`;
const NOT_LETTER_BEFORE = String.raw`(?<![\p{L}])`;
const NOT_LETTER_AFTER = String.raw`(?![\p{L}])`;

const CLAIM = new RegExp(
  [
    // "registré", "pagué"…
    `${NOT_LETTER_BEFORE}(?:${FIRST_PERSON})${NOT_LETTER_AFTER}`,
    // "quedó configurado", "ya quedaron pagadas"
    String.raw`${NOT_LETTER_BEFORE}(?:qued[óo]|quedaron|ya\s+(?:est[áa]n?|qued[óo]))\s+(?:\p{L}+\s+){0,2}(?:${PARTICIPLE})${NOT_LETTER_AFTER}`,
    // "Registrado: Cena…" al inicio de una línea
    String.raw`(?:^|\n)\s*(?:listo[,.!:]?\s*)?(?:${PARTICIPLE})\s*:`,
    // "definido en $450.000", "registrado por $45.000"
    String.raw`${NOT_LETTER_BEFORE}(?:${PARTICIPLE})\s+(?:en|por|a|con|de|para)\s+\$`
  ].join('|'),
  'iu'
);
const MONEY = /\$\s?\d/;

/** true si el texto afirma que se hizo un cambio. */
export const claimsWrite = (text) => CLAIM.test(text ?? '');

/** true si el texto da cifras de dinero. */
export const mentionsMoney = (text) => MONEY.test(text ?? '');

/** true si el texto le pregunta algo al usuario. */
export const asksUser = (text) => /[?¿]/.test(text ?? '');

export const CLAIM_CORRECTION =
  'VERIFICACIÓN AUTOMÁTICA DEL SISTEMA (no es el usuario): tu respuesta afirma que se registró, pagó, ' +
  'editó, eliminó o configuró algo, pero en este turno ninguna herramienta de escritura devolvió ok: true. ' +
  'No se guardó nada. Si el usuario ya dio la confirmación (en este mensaje o respondiendo a tu pregunta anterior), ' +
  'llama AHORA las herramientas necesarias, una llamada por cada elemento. Si todavía falta un dato o una confirmación, ' +
  'pregunta sin afirmar que ya está hecho. Si te refieres a algo hecho en turnos anteriores, consulta el backend y ' +
  'dilo en esos términos ("ya estaba registrado").';

export const DATA_CORRECTION =
  'VERIFICACIÓN AUTOMÁTICA DEL SISTEMA (no es el usuario): respondiste con cifras sin consultar el backend en este turno. ' +
  'El historial puede estar desactualizado o equivocado. Si el usuario pidió datos (saldos, listas, totales, facturas, ' +
  'gastos), llama la herramienta de consulta adecuada y responde solo con lo que devuelva. Si solo estás pidiendo ' +
  'confirmación de montos antes de registrar, reformula la respuesta como una pregunta y no ejecutes nada.';

export const UNVERIFIED_TEXT =
  'No pude confirmar que el cambio quedara guardado, así que no lo doy por hecho. ' +
  '¿Me lo repites para registrarlo de nuevo?';

/**
 * Decide qué hacer con una respuesta final.
 * - 'claim': afirma un cambio sin escritura exitosa en el turno.
 * - 'data': da cifras sin haber consultado nada y sin preguntar.
 * @returns {'ok' | 'claim' | 'data'}
 */
export function reviewAnswer({ text, toolCalls }) {
  const wroteOk = toolCalls.some((call) => WRITE_TOOLS.has(call.name) && call.ok);
  if (!wroteOk && claimsWrite(text)) return 'claim';
  if (toolCalls.length === 0 && mentionsMoney(text) && !asksUser(text)) return 'data';
  return 'ok';
}

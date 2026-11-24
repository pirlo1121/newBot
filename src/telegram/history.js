const MAX_TOOL_RESULT_CHARS = 3000;

/** Copia del mensaje para el historial: sin razonamiento y con resultados acotados. */
function compact(message) {
  const { reasoning_content: _reasoning, ...rest } = message;
  if (rest.role === 'tool' && typeof rest.content === 'string' && rest.content.length > MAX_TOOL_RESULT_CHARS) {
    return { ...rest, content: `${rest.content.slice(0, MAX_TOOL_RESULT_CHARS)}… [recortado]` };
  }
  return rest;
}

/**
 * Historial corto por chat, en memoria, guardado por turnos completos:
 * mensaje del usuario, llamadas a herramientas, resultados y respuesta.
 * Así el modelo ve que cada cambio anterior pasó por el backend y no imita
 * respuestas de "listo" sin llamada (incidente del 2026-11-24).
 * Se recorta por turnos enteros para no dejar resultados huérfanos.
 * `maxMessages` cuenta solo los mensajes de texto (usuario + respuesta).
 */
export function createHistory(maxMessages = 20) {
  const maxTurns = Math.max(1, Math.floor(maxMessages / 2));
  const chats = new Map();
  return {
    get: (chatId) => (chats.get(chatId) ?? []).flat(),
    addTurn(chatId, messages) {
      const turns = [...(chats.get(chatId) ?? []), messages.map(compact)];
      chats.set(chatId, turns.slice(-maxTurns));
    },
    clear: (chatId) => chats.delete(chatId)
  };
}

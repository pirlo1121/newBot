import { nowInTz, todayInTz } from '../domain/dates.js';
import { buildSystemPrompt } from './prompt.js';
import { executeTool, toolDefinitions } from './tools.js';

export const MAX_ROUNDS = 6;
export const FALLBACK_TEXT =
  'Perdona, no logré completar tu solicitud en este momento. ¿Puedes intentarlo de nuevo con otras palabras?';

export class AiError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'AiError';
  }
}

/**
 * Bucle de function calling contra una API compatible con OpenAI (§10.2).
 * El modelo solo ve resultados del backend; nunca la base de datos.
 */
export function createOrchestrator({
  baseUrl,
  apiKey,
  model,
  api,
  fetch: fetchImpl = globalThis.fetch,
  clock = { now: () => new Date() },
  timezone = 'America/Bogota',
  logger,
  maxRounds = MAX_ROUNDS,
  timeoutMs = 30_000
}) {
  const tools = toolDefinitions();
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

  async function complete(messages) {
    const headers = { 'content-type': 'application/json' };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, tools, tool_choice: 'auto' }),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw new AiError('No se pudo contactar al proveedor de IA.', error);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new AiError(`El proveedor de IA respondió HTTP ${response.status}: ${detail.slice(0, 200)}`);
    }
    const json = await response.json();
    const message = json?.choices?.[0]?.message;
    if (!message) throw new AiError('Respuesta del proveedor de IA sin mensaje.');
    return message;
  }

  /**
   * @param {{ history: Array<{role: string, content: string}>, text: string }} input
   * @returns {Promise<{ text: string, toolCalls: Array<{name: string, ok: boolean, ms: number}> }>}
   */
  async function reply({ history = [], text }) {
    const now = clock.now();
    const messages = [
      {
        role: 'system',
        content: buildSystemPrompt({
          nowLocal: nowInTz(now, timezone),
          today: todayInTz(now, timezone),
          timezone
        })
      },
      ...history,
      { role: 'user', content: text }
    ];
    const toolCalls = [];

    for (let round = 0; round <= maxRounds; round += 1) {
      const message = await complete(messages);
      const calls = message.tool_calls ?? [];

      if (calls.length === 0) {
        return { text: (message.content ?? '').trim() || FALLBACK_TEXT, toolCalls };
      }
      if (round === maxRounds) break;

      messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const started = Date.now();
        const result = await executeTool(call.function?.name, call.function?.arguments, api);
        const entry = { name: call.function?.name, ok: result?.ok === true, ms: Date.now() - started };
        toolCalls.push(entry);
        logger?.info({ tool: entry.name, ok: entry.ok, duration_ms: entry.ms }, 'herramienta ejecutada');
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }

    logger?.warn({ rounds: maxRounds, tools: toolCalls.map((c) => c.name) }, 'límite de rondas de herramientas');
    return { text: FALLBACK_TEXT, toolCalls };
  }

  return { reply };
}

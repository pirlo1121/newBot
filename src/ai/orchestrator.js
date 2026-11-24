import { nowInTz, todayInTz } from '../domain/dates.js';
import { CLAIM_CORRECTION, DATA_CORRECTION, reviewAnswer, UNVERIFIED_TEXT, WRITE_TOOLS } from './guard.js';
import { buildSystemPrompt } from './prompt.js';
import { executeTool, toolDefinitions } from './tools.js';

export const MAX_ROUNDS = 6;
export const MAX_CORRECTIONS = 2;
export const FALLBACK_TEXT =
  'Perdona, no logré completar tu solicitud en este momento. ¿Puedes intentarlo de nuevo con otras palabras?';

export class AiError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = 'AiError';
  }
}

/** Mensaje del asistente tal como se reenvía al modelo dentro del mismo turno. */
function assistantMessage(message) {
  const out = { role: 'assistant', content: message.content ?? null };
  if (message.tool_calls?.length) out.tool_calls = message.tool_calls;
  // Modelos con razonamiento (p. ej. DeepSeek) lo necesitan de vuelta dentro del turno.
  if (message.reasoning_content) out.reasoning_content = message.reasoning_content;
  return out;
}

/**
 * Bucle de function calling contra una API compatible con OpenAI (§10.2).
 * El modelo solo ve resultados del backend; nunca la base de datos.
 *
 * La respuesta final se verifica contra las herramientas ejecutadas en el
 * turno (src/ai/guard.js): si afirma un cambio sin escritura exitosa, o da
 * cifras sin consultar, se le pide corregir; si insiste, no se entrega.
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
  maxCorrections = MAX_CORRECTIONS,
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
        body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0.2 }),
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
   * @param {{ history: Array<object>, text: string }} input
   * @returns {Promise<{
   *   text: string,
   *   toolCalls: Array<{name: string, ok: boolean, ms: number}>,
   *   corrections: string[],
   *   messages: Array<object>
   * }>} `messages` es el turno completo (usuario, llamadas, resultados y
   * respuesta) para guardarlo en el historial; excluye borradores rechazados.
   */
  async function reply({ history = [], text }) {
    const now = clock.now();
    const system = {
      role: 'system',
      content: buildSystemPrompt({
        nowLocal: nowInTz(now, timezone),
        today: todayInTz(now, timezone),
        timezone
      })
    };
    const turn = [{ role: 'user', content: text }];
    let scratch = []; // borradores rechazados + correcciones: solo para este turno
    const toolCalls = [];
    const corrections = [];
    let toolRounds = 0;

    const finish = (answer) => {
      turn.push({ role: 'assistant', content: answer });
      return { text: answer, toolCalls, corrections, messages: turn };
    };

    // Como máximo: maxRounds rondas de herramientas + maxCorrections correcciones + la respuesta.
    for (;;) {
      const message = await complete([system, ...history, ...turn, ...scratch]);
      const calls = message.tool_calls ?? [];

      if (calls.length === 0) {
        const answer = (message.content ?? '').trim();
        if (!answer) return finish(FALLBACK_TEXT);

        const verdict = reviewAnswer({ text: answer, toolCalls });
        if (verdict === 'ok') return finish(answer);

        if (corrections.length >= maxCorrections) {
          logger?.warn({ verdict, tools: toolCalls.map((c) => c.name) }, 'respuesta no verificada');
          // Afirmar un cambio sin haber escrito ni consultado nada no se entrega. Si el modelo
          // consultó el backend, puede estar hablando de cambios de turnos anteriores.
          const hadReads = toolCalls.some((c) => !WRITE_TOOLS.has(c.name) && c.ok);
          return finish(verdict === 'claim' && !hadReads ? UNVERIFIED_TEXT : answer);
        }

        corrections.push(verdict);
        logger?.info({ verdict }, 'respuesta del modelo devuelta para corrección');
        scratch.push(
          { role: 'assistant', content: answer },
          { role: 'system', content: verdict === 'claim' ? CLAIM_CORRECTION : DATA_CORRECTION }
        );
        continue;
      }

      toolRounds += 1;
      if (toolRounds > maxRounds) break;

      // Las correcciones ya cumplieron su función: el turno sigue con datos reales.
      scratch = [];
      turn.push(assistantMessage({ ...message, tool_calls: calls }));
      for (const call of calls) {
        const started = Date.now();
        const result = await executeTool(call.function?.name, call.function?.arguments, api);
        const entry = { name: call.function?.name, ok: result?.ok === true, ms: Date.now() - started };
        toolCalls.push(entry);
        logger?.info({ tool: entry.name, ok: entry.ok, duration_ms: entry.ms }, 'herramienta ejecutada');
        turn.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }

    logger?.warn({ rounds: maxRounds, tools: toolCalls.map((c) => c.name) }, 'límite de rondas de herramientas');
    const wrote = toolCalls.some((c) => WRITE_TOOLS.has(c.name) && c.ok);
    return finish(wrote ? `${FALLBACK_TEXT} Algunos cambios sí se guardaron; pregúntame el saldo para revisarlo.` : FALLBACK_TEXT);
  }

  return { reply };
}

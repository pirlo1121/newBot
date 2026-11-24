/**
 * Cliente HTTP del backend para la IA y el bot. Nunca toca SQLite:
 * todo pasa por la API con X-Api-Key (AGENTS.md §3, D-01).
 * Los errores de red se devuelven con el mismo envelope { ok: false }.
 */
export function createApiClient({ baseUrl, apiKey, fetch: fetchImpl = globalThis.fetch, timeoutMs = 10_000 }) {
  async function request(method, path, { query, body } = {}) {
    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    }

    const headers = { 'x-api-key': apiKey, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';

    try {
      const response = await fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const json = await response.json().catch(() => null);
      if (json && typeof json.ok === 'boolean') return json;
      return {
        ok: false,
        error: { code: 'BACKEND_ERROR', message: `Respuesta inesperada del backend (HTTP ${response.status}).` }
      };
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      return {
        ok: false,
        error: {
          code: timedOut ? 'BACKEND_TIMEOUT' : 'BACKEND_UNAVAILABLE',
          message: timedOut ? 'El backend tardó demasiado en responder.' : 'No pude comunicarme con el backend.'
        }
      };
    }
  }

  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body = {}) => request('POST', path, { body }),
    put: (path, body) => request('PUT', path, { body }),
    patch: (path, body) => request('PATCH', path, { body }),
    delete: (path) => request('DELETE', path)
  };
}

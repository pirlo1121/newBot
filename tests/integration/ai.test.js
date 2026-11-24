import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiClient } from '../../src/ai/apiClient.js';
import { createOrchestrator, FALLBACK_TEXT, AiError } from '../../src/ai/orchestrator.js';
import { executeTool } from '../../src/ai/tools.js';
import { API_KEY, createTestApp, fakeAiServer, listen, say, toolCall } from '../helpers/setup.js';

async function backend() {
  const t = createTestApp();
  const server = await listen(t.app);
  const api = createApiClient({ baseUrl: server.baseUrl, apiKey: API_KEY });
  return { t, server, api };
}

test('las herramientas funcionan contra la API real por HTTP', async () => {
  const { server, api } = await backend();
  try {
    let r = await executeTool('configurar_salario', { monto: '3.500.000' }, api);
    assert.equal(r.ok, true);
    r = await executeTool('crear_gasto_fijo', { nombre: 'Arriendo', monto: '900.000', dia_pago: 1 }, api);
    r = await executeTool('consultar_facturas', { estado: 'pendientes' }, api);
    const facturaId = r.data.items[0].id;
    r = await executeTool('pagar_factura', { factura_id: facturaId }, api);
    assert.equal(r.data.balance.formatted.balance, '$2.600.000');
    r = await executeTool('pagar_factura', { factura_id: facturaId }, api);
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'ALREADY_PAID');
    r = await executeTool('consultar_cierre_mensual', {}, api);
    assert.equal(r.error.code, 'NOT_FOUND');
  } finally {
    await server.close();
  }
});

test('el cliente informa backend caído o API key incorrecta sin lanzar', async () => {
  let api = createApiClient({ baseUrl: 'http://127.0.0.1:1', apiKey: API_KEY, timeoutMs: 500 });
  let r = await api.get('/api/context');
  assert.equal(r.ok, false);
  assert.match(r.error.code, /BACKEND_/);

  const { server } = await backend();
  try {
    api = createApiClient({ baseUrl: server.baseUrl, apiKey: 'otra-clave-123456789' });
    r = await api.get('/api/context');
    assert.equal(r.error.code, 'UNAUTHORIZED');
  } finally {
    await server.close();
  }
});

test('bucle de function calling: herramientas, validación y respuesta final', async () => {
  const { server, api } = await backend();
  const ai = await fakeAiServer([
    toolCall(['registrar_gasto_extra', { nombre: 'Cena', monto: 'abc€' }]), // el backend rechaza el monto
    toolCall(['registrar_gasto_extra', { nombre: 'Cena', categoria: 'otra' }]), // zod rechaza
    toolCall(['registrar_gasto_extra', { nombre: 'Cena', monto: '45.000', categoria: 'comida' }], ['consultar_saldo', {}]),
    say('Listo, registré la cena por $45.000.')
  ]);
  try {
    const orchestrator = createOrchestrator({
      baseUrl: ai.baseUrl,
      apiKey: 'clave-ia',
      model: 'modelo-falso',
      api,
      clock: { now: () => new Date('2026-11-24T15:00:00Z') }
    });
    const result = await orchestrator.reply({
      history: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: '¡Hola!' }],
      text: 'gasté 45 mil en una cena'
    });

    assert.equal(result.text, 'Listo, registré la cena por $45.000.');
    assert.deepEqual(result.toolCalls.map((c) => [c.name, c.ok]), [
      ['registrar_gasto_extra', false],
      ['registrar_gasto_extra', false],
      ['registrar_gasto_extra', true],
      ['consultar_saldo', true]
    ]);

    const first = ai.requests[0];
    assert.equal(first.headers.authorization, 'Bearer clave-ia');
    assert.equal(first.url, '/v1/chat/completions');
    assert.equal(first.body.model, 'modelo-falso');
    assert.equal(first.body.tools.length, 19);
    assert.match(first.body.messages[0].content, /2026-11-24 10:00/);
    assert.equal(first.body.messages.at(-1).content, 'gasté 45 mil en una cena');

    // El resultado de la herramienta vuelve al modelo como mensaje "tool".
    const second = ai.requests[1].body.messages.at(-1);
    assert.equal(second.role, 'tool');
    assert.equal(JSON.parse(second.content).error.code, 'VALIDATION_ERROR');

    const last = ai.requests[3].body.messages;
    const balance = JSON.parse(last.at(-1).content);
    assert.equal(balance.data.formatted.extra_expenses, '$45.000');
  } finally {
    await ai.close();
    await server.close();
  }
});

test('máximo 6 rondas de herramientas y luego disculpa', async () => {
  const { server, api } = await backend();
  const ai = await fakeAiServer(() => toolCall(['consultar_limite', {}]));
  try {
    const orchestrator = createOrchestrator({ baseUrl: ai.baseUrl, model: 'm', api });
    const result = await orchestrator.reply({ text: 'bucle' });
    assert.equal(result.text, FALLBACK_TEXT);
    assert.equal(result.toolCalls.length, 6);
    assert.equal(ai.requests.length, 7);
    assert.equal(ai.requests[0].headers.authorization, undefined);
  } finally {
    await ai.close();
    await server.close();
  }
});

test('error del proveedor de IA se propaga como AiError', async () => {
  const ai = await fakeAiServer([{ status: 500 }]);
  try {
    const orchestrator = createOrchestrator({ baseUrl: ai.baseUrl, model: 'm', api: {} });
    await assert.rejects(orchestrator.reply({ text: 'hola' }), AiError);
  } finally {
    await ai.close();
  }
});

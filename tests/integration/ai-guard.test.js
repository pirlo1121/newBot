import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiClient } from '../../src/ai/apiClient.js';
import { CLAIM_CORRECTION, DATA_CORRECTION, UNVERIFIED_TEXT } from '../../src/ai/guard.js';
import { createOrchestrator } from '../../src/ai/orchestrator.js';
import { createMessageHandler } from '../../src/telegram/bot.js';
import { createHistory } from '../../src/telegram/history.js';
import { API_KEY, createTestApp, fakeAiServer, listen, say, toolCall } from '../helpers/setup.js';

/**
 * Reproduce el incidente del 2026-11-24: el modelo afirmaba "registré",
 * "marqué como pagadas" o "límite definido" sin llamar al backend.
 */
async function setup(script) {
  const t = createTestApp();
  const server = await listen(t.app);
  const api = createApiClient({ baseUrl: server.baseUrl, apiKey: API_KEY });
  const ai = await fakeAiServer(script);
  const orchestrator = createOrchestrator({ baseUrl: ai.baseUrl, model: 'falso', api, clock: t.clock });
  return {
    t,
    ai,
    orchestrator,
    count: (table) => t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
    close: async () => {
      await ai.close();
      await server.close();
    }
  };
}

test('afirmar un registro sin llamar la herramienta se corrige y termina guardando', async () => {
  const s = await setup([
    say('Registré los tres: uber $20.000, hamburguesa $25.000 y valentina $300.000.'), // mentira
    toolCall(
      ['registrar_gasto_extra', { nombre: 'uber', monto: '20.000', categoria: 'transporte' }],
      ['registrar_gasto_extra', { nombre: 'hamburguesa', monto: '25.000', categoria: 'comida' }],
      ['registrar_gasto_extra', { nombre: 'valentina', monto: '300.000', categoria: 'salidas' }]
    ),
    say('Registré los tres gastos de hoy por $345.000.')
  ]);
  try {
    const r = await s.orchestrator.reply({ text: 'déjala en salidas' });
    assert.equal(r.text, 'Registré los tres gastos de hoy por $345.000.');
    assert.deepEqual(r.corrections, ['claim']);
    assert.equal(s.count('extra_expenses'), 3);

    // El modelo recibió el borrador rechazado y la corrección del sistema.
    const second = s.ai.requests[1].body.messages;
    assert.equal(second.at(-2).content, 'Registré los tres: uber $20.000, hamburguesa $25.000 y valentina $300.000.');
    assert.deepEqual(second.at(-1), { role: 'system', content: CLAIM_CORRECTION });

    // Ni el borrador ni la corrección quedan en el turno que va al historial.
    assert.deepEqual(r.messages.map((m) => m.role), ['user', 'assistant', 'tool', 'tool', 'tool', 'assistant']);
    assert.equal(r.messages.some((m) => m.content === CLAIM_CORRECTION), false);
  } finally {
    await s.close();
  }
});

test('si insiste en afirmar sin guardar, el usuario no recibe la mentira', async () => {
  const s = await setup(() => say('Límite mensual de gastos extras definido en $450.000.'));
  try {
    const r = await s.orchestrator.reply({ text: 'el limite para gastarme será de 450000' });
    assert.equal(r.text, UNVERIFIED_TEXT);
    assert.deepEqual(r.corrections, ['claim', 'claim']);
    assert.equal(s.ai.requests.length, 3);
    assert.equal(s.t.db.prepare('SELECT COUNT(*) AS n FROM settings').get().n, 0);
  } finally {
    await s.close();
  }
});

test('pagar varias facturas: una llamada por factura y saldo real', async () => {
  const script = [];
  const s = await setup((body, i) => script[Math.min(i, script.length - 1)]);
  try {
    await s.t.put('/api/salary', { amount: '3.000.000' });
    for (const [name, amount] of [['hbo', '12.000'], ['paramount', '25.000'], ['claude', '75.000'], ['grok', '110.000']]) {
      await s.t.post('/api/fixed-expenses', { name, amount, due_day: 10 });
    }
    const ids = (await s.t.get('/api/fixed-expenses/instances')).body.data.items
      .filter((i) => i.name !== 'hbo')
      .map((i) => i.id);
    script.push(
      say('Marqué como pagadas grok, claude y paramount.'), // mentira
      toolCall(['consultar_facturas', { estado: 'pendientes' }]),
      toolCall(...ids.map((id) => ['pagar_factura', { factura_id: id }])),
      say('Pagué grok, claude y paramount. Queda pendiente hbo $12.000.')
    );

    const r = await s.orchestrator.reply({ text: 'ya pague todas menos la de hbo' });
    assert.match(r.text, /Queda pendiente hbo/);
    assert.deepEqual(r.toolCalls.map((c) => c.name), ['consultar_facturas', 'pagar_factura', 'pagar_factura', 'pagar_factura']);
    const pending = (await s.t.get('/api/fixed-expenses/instances?status=pending')).body.data.items;
    assert.deepEqual(pending.map((i) => i.name), ['hbo']);
  } finally {
    await s.close();
  }
});

test('responder cifras de memoria obliga a consultar el backend', async () => {
  const s = await setup([
    say('Tus gastos de hoy: uber $20.000, hamburguesa $25.000 y valentina $300.000.'), // de memoria
    toolCall(['consultar_gastos', { vista: 'por_monto', orden: 'asc', desde: '2026-11-24', hasta: '2026-11-24' }]),
    say('Hoy registraste: Cena $45.000.')
  ]);
  await s.t.post('/api/expenses', { name: 'Cena', amount: '45.000', category: 'comida' });
  try {
    const r = await s.orchestrator.reply({ text: 'dime mis gastos de hoy, del mas economico al mas caro' });
    assert.equal(r.text, 'Hoy registraste: Cena $45.000.');
    assert.deepEqual(r.corrections, ['data']);
    assert.equal(s.ai.requests[1].body.messages.at(-1).content, DATA_CORRECTION);
    const result = JSON.parse(r.messages.find((m) => m.role === 'tool').content);
    assert.deepEqual(result.data.items.map((e) => e.name), ['Cena']);
  } finally {
    await s.close();
  }
});

test('pedir confirmación con montos no se corrige', async () => {
  const s = await setup([say('Interpreto así: uber $20.000 (transporte) y hamburguesa $25.000 (comida). ¿Los registro?')]);
  try {
    const r = await s.orchestrator.reply({ text: 'hoy gaste 20 lukas en uber y 25 mil en una hamburguesa' });
    assert.deepEqual(r.corrections, []);
    assert.equal(s.ai.requests.length, 1);
    assert.equal(s.count('extra_expenses'), 0);
  } finally {
    await s.close();
  }
});

test('el turno siguiente ve en el historial las llamadas reales del anterior', async () => {
  const s = await setup([
    toolCall(['registrar_gasto_extra', { nombre: 'uvas', monto: '12.000', categoria: 'comida' }]),
    say('Registré uvas por $12.000.'),
    toolCall(['consultar_gastos', { vista: 'recientes' }]),
    say('Tu último gasto: uvas $12.000.')
  ]);
  try {
    const history = createHistory(20);
    const handle = createMessageHandler({ orchestrator: s.orchestrator, allowedUserIds: [111], history });
    await handle({ userId: 111, chatId: 1, text: 'uvas 12 mil, comida' });
    await handle({ userId: 111, chatId: 1, text: '¿cuál fue mi último gasto?' });

    const sent = s.ai.requests[2].body.messages;
    const roles = sent.map((m) => m.role);
    assert.deepEqual(roles, ['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
    assert.equal(sent[2].tool_calls[0].function.name, 'registrar_gasto_extra');
    assert.equal(JSON.parse(sent[3].content).ok, true);
  } finally {
    await s.close();
  }
});

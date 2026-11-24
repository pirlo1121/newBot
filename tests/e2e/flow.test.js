import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiClient } from '../../src/ai/apiClient.js';
import { createOrchestrator } from '../../src/ai/orchestrator.js';
import { createMessageHandler } from '../../src/telegram/bot.js';
import { deliverNotifications } from '../../src/telegram/notifications.js';
import { API_KEY, createTestApp, fakeAiServer, listen, say, toolCall } from '../helpers/setup.js';

/**
 * Flujo completo con reloj inyectado (AGENTS.md §13): salario → gastos fijos →
 * pagar → gastos extras hasta 80 % y 100 % → consultas → cierre → ahorro y
 * facturas del mes siguiente. La "IA" es un servidor falso que sigue un guion
 * y la respuesta final cita lo que devolvió la última herramienta.
 */
test('flujo de un mes completo desde Telegram', async () => {
  const t = createTestApp({ now: '2026-11-01T09:00' });
  const backend = await listen(t.app);
  const api = createApiClient({ baseUrl: backend.baseUrl, apiKey: API_KEY });

  const queue = [];
  const ai = await fakeAiServer((body) => {
    const last = body.messages.at(-1);
    if (last.role === 'tool') {
      const result = JSON.parse(last.content);
      return say(result.ok ? `OK ${JSON.stringify(result.data).slice(0, 2000)}` : `ERROR ${result.error.code}`);
    }
    return queue.shift();
  });

  const orchestrator = createOrchestrator({ baseUrl: ai.baseUrl, model: 'falso', api, clock: t.clock });
  const handle = createMessageHandler({ orchestrator, allowedUserIds: [111] });
  const inbox = [];
  const flush = () =>
    deliverNotifications({ api, chatIds: [111], send: async (_, text) => inbox.push(text) });
  const chat = async (text, ...calls) => {
    queue.push(toolCall(...calls));
    const answer = await handle({ userId: 111, chatId: 111, text });
    await flush();
    return answer;
  };

  try {
    await chat('mi salario es 3.500.000, me pagan el 1', ['configurar_salario', { monto: '3.500.000', dia_pago: 1 }]);
    await chat('el arriendo es 900.000 el día 1', ['crear_gasto_fijo', { nombre: 'Arriendo', monto: '900.000', dia_pago: 1 }]);
    await chat('el internet son 100.000 el 15', ['crear_gasto_fijo', { nombre: 'Internet', monto: '100.000', dia_pago: 15 }]);
    await chat('límite de 600.000', ['definir_limite_mensual', { monto: '600.000' }]);

    const bills = JSON.parse(
      (await chat('facturas pendientes', ['consultar_facturas', { estado: 'pendientes' }])).slice(3)
    );
    const rent = bills.items.find((b) => b.name === 'Arriendo');
    let answer = await chat('pagué el arriendo', ['pagar_factura', { factura_id: rent.id }]);
    assert.match(answer, /"balance":"\$2\.600\.000"/);
    answer = await chat('pagué el arriendo otra vez', ['pagar_factura', { factura_id: rent.id }]);
    assert.equal(answer, 'ERROR ALREADY_PAID');

    t.clock.set('2026-11-10T20:00');
    await chat('cena 300.000', ['registrar_gasto_extra', { nombre: 'Cena', monto: '300.000', categoria: 'comida' }]);
    assert.equal(inbox.length, 0);
    answer = await chat('taxi 180.000', ['registrar_gasto_extra', { nombre: 'Taxi', monto: '180.000', categoria: 'transporte' }]);
    assert.match(answer, /limite_80/);
    assert.equal(inbox.length, 1);
    assert.match(inbox[0], /80 %/);

    t.clock.set('2026-11-20T12:00');
    await chat('reloj 150.000', ['registrar_gasto_extra', { nombre: 'Reloj', monto: '150.000', categoria: 'lujo' }]);
    assert.equal(inbox.length, 2);
    assert.match(inbox[1], /Alcanzaste tu límite/);
    await chat('chicle 1.000', ['registrar_gasto_extra', { nombre: 'Chicle', monto: '1.000' }]);
    assert.equal(inbox.length, 2, 'no se repiten avisos');

    answer = await chat('¿cuánto me queda?', ['consultar_saldo', {}]);
    assert.match(answer, /"balance":"\$1\.969\.000"/);
    answer = await chat('gastos por categoría', ['consultar_gastos', { vista: 'por_categoria' }]);
    assert.match(answer, /"category":"comida"/);
    answer = await chat('de mayor a menor', ['consultar_gastos', { vista: 'por_monto' }]);
    assert.match(answer, /"items":\[\{"id":\d+,"name":"Cena"/);
    answer = await chat('últimos 3 días', ['consultar_gastos', { vista: 'por_dias', dias: 3 }]);
    assert.match(answer, /"from":"2026-11-17"/);

    // Llega el pago de diciembre: el scheduler/primer request cierra noviembre.
    t.clock.set('2026-12-01T00:05');
    await flush();
    assert.equal(inbox.length, 3);
    assert.match(inbox[2], /Cierre de noviembre de 2026/);
    assert.match(inbox[2], /Ahorro del mes: \$1\.969\.000/);
    assert.match(inbox[2], /Mayor gasto: Comida/);
    assert.match(inbox[2], /Menor gasto: Sin categoría/);

    answer = await chat('¿cuánto ahorro tengo?', ['consultar_ahorro', {}]);
    assert.match(answer, /"balance":"\$1\.969\.000"/);
    answer = await chat('facturas de diciembre', ['consultar_facturas', { estado: 'pendientes' }]);
    assert.match(answer, /"period":"2026-12"/);
    assert.equal(JSON.parse(answer.slice(3)).count, 2);

    answer = await chat('borra la cena de noviembre', ['eliminar_gasto_extra', { id: 1 }]);
    assert.equal(answer, 'ERROR PERIOD_CLOSED');
  } finally {
    await ai.close();
    await backend.close();
  }
});

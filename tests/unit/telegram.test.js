import assert from 'node:assert/strict';
import test from 'node:test';

import { createMessageHandler, createTelegramBot, splitMessage, MAX_MESSAGE_LENGTH } from '../../src/telegram/bot.js';
import { createHistory } from '../../src/telegram/history.js';
import { deliverNotifications } from '../../src/telegram/notifications.js';
import { createRateLimiter } from '../../src/telegram/rateLimiter.js';
import { msUntilNext } from '../../src/scheduler.js';

const fakeOrchestrator = () => {
  const seen = [];
  return {
    seen,
    reply: async ({ history, text }) => {
      seen.push({ history, text });
      return { text: `eco: ${text}`, toolCalls: [] };
    }
  };
};

test('ignora usuarios fuera de la lista blanca', async () => {
  const orchestrator = fakeOrchestrator();
  const handle = createMessageHandler({ orchestrator, allowedUserIds: [111] });
  assert.equal(await handle({ userId: 999, chatId: 999, text: 'hola' }), null);
  assert.equal(orchestrator.seen.length, 0);
});

test('mantiene historial corto por chat, por turnos', async () => {
  const orchestrator = fakeOrchestrator();
  const history = createHistory(4);
  const handle = createMessageHandler({ orchestrator, allowedUserIds: [111], history });
  for (const text of ['uno', 'dos', 'tres']) await handle({ userId: 111, chatId: 1, text });
  assert.deepEqual(orchestrator.seen[2].history.map((m) => m.content), ['uno', 'eco: uno', 'dos', 'eco: dos']);
  assert.equal(history.get(1).length, 4);
  assert.equal(history.get(2).length, 0);
});

test('el historial conserva llamadas y resultados de herramientas sin dejar huérfanos', () => {
  const history = createHistory(4); // 2 turnos
  const turn = (n) => [
    { role: 'user', content: `gasto ${n}` },
    { role: 'assistant', content: null, tool_calls: [{ id: `c${n}`, type: 'function', function: { name: 'registrar_gasto_extra', arguments: '{}' } }], reasoning_content: 'pienso' },
    { role: 'tool', tool_call_id: `c${n}`, content: 'x'.repeat(5000) },
    { role: 'assistant', content: `Registré el gasto ${n}.` }
  ];
  for (const n of [1, 2, 3]) history.addTurn(1, turn(n));
  const messages = history.get(1);
  assert.equal(messages.length, 8);
  assert.equal(messages[0].content, 'gasto 2');
  assert.equal(messages[1].tool_calls[0].id, 'c2');
  assert.equal('reasoning_content' in messages[1], false);
  assert.equal(messages[2].role, 'tool');
  assert.ok(messages[2].content.length < 3100);
  assert.match(messages[2].content, /recortado/);
});

test('límite de tasa y longitud máxima', async () => {
  const orchestrator = fakeOrchestrator();
  const handle = createMessageHandler({
    orchestrator,
    allowedUserIds: [111],
    rateLimiter: createRateLimiter({ max: 2, windowMs: 60_000 })
  });
  assert.match(await handle({ userId: 111, chatId: 1, text: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) }), /muy largo/);
  await handle({ userId: 111, chatId: 1, text: 'a' });
  assert.match(await handle({ userId: 111, chatId: 1, text: 'b' }), /muy rápido/);
});

test('un fallo del orquestador responde un mensaje amable', async () => {
  const handle = createMessageHandler({
    orchestrator: { reply: async () => { throw new Error('caído'); } },
    allowedUserIds: [111]
  });
  assert.match(await handle({ userId: 111, chatId: 1, text: 'hola' }), /problema/);
});

test('rate limiter de ventana deslizante', () => {
  let now = 0;
  const allow = createRateLimiter({ max: 2, windowMs: 1000, now: () => now });
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), true);
  assert.equal(allow('a'), false);
  assert.equal(allow('b'), true);
  now = 1001;
  assert.equal(allow('a'), true);
});

test('entrega la outbox y solo marca lo enviado', async () => {
  const acked = [];
  const api = {
    get: async () => ({ ok: true, data: { items: [{ id: 1, text: 'uno' }, { id: 2, text: 'dos' }] } }),
    post: async (path) => {
      acked.push(path);
      return { ok: true };
    }
  };
  const sent = [];
  let n = await deliverNotifications({ api, chatIds: [111], send: async (chat, text) => sent.push([chat, text]) });
  assert.equal(n, 2);
  assert.deepEqual(sent, [[111, 'uno'], [111, 'dos']]);
  assert.deepEqual(acked, ['/api/notifications/1/ack', '/api/notifications/2/ack']);

  acked.length = 0;
  n = await deliverNotifications({
    api,
    chatIds: [111],
    send: async (chat, text) => {
      if (text === 'dos') throw new Error('telegram caído');
    }
  });
  assert.equal(n, 1);
  assert.deepEqual(acked, ['/api/notifications/1/ack']);
});

test('splitMessage respeta el máximo de Telegram', () => {
  const text = `${'a'.repeat(3000)}\n${'b'.repeat(3000)}`;
  const parts = splitMessage(text);
  assert.equal(parts.length, 2);
  assert.ok(parts.every((p) => p.length <= 4096));
  assert.deepEqual(splitMessage('hola'), ['hola']);
});

test('el bot de grammY registra comandos y responde con la lógica central', async () => {
  const handlers = {};
  const sent = [];
  class FakeBot {
    constructor(token) {
      this.token = token;
      this.api = { sendMessage: async (chat, text) => sent.push([chat, text]) };
    }
    command(names, fn) { for (const n of names) handlers[`/${n}`] = fn; }
    on(filter, fn) { handlers[filter] = fn; }
    catch() {}
  }
  const api = { get: async () => ({ ok: true, data: { items: [{ id: 9, text: 'aviso' }] } }), post: async () => ({ ok: true }) };
  const telegram = createTelegramBot({
    token: 't',
    allowedUserIds: [111],
    orchestrator: fakeOrchestrator(),
    api,
    BotClass: FakeBot
  });
  assert.ok(telegram.bot instanceof FakeBot);

  const replies = [];
  const ctx = (from, text) => ({
    from: { id: from },
    chat: { id: from },
    message: { text },
    reply: async (t) => replies.push(t),
    replyWithChatAction: async () => {}
  });
  await handlers['/ayuda'](ctx(111, '/ayuda'));
  assert.match(replies[0], /Gasté 45\.000/);
  await handlers['message:text'](ctx(222, 'hola'));
  assert.equal(sent.length, 0);
  await handlers['message:text'](ctx(111, 'hola'));
  assert.deepEqual(sent, [[111, 'eco: hola'], [111, 'aviso']]);
});

test('el job diario se programa para las 00:05 de Bogotá', () => {
  const now = new Date('2026-11-24T15:00:00Z'); // 10:00 Bogotá
  assert.equal(msUntilNext({ hour: 0, minute: 5, tz: 'America/Bogota', now }), (14 * 60 + 5) * 60_000);
  const justAfter = new Date('2026-11-25T05:05:00Z'); // 00:05 en punto → mañana
  assert.equal(msUntilNext({ hour: 0, minute: 5, tz: 'America/Bogota', now: justAfter }), 24 * 3600_000);
});

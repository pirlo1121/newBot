import { Bot } from 'grammy';

import { createHistory } from './history.js';
import { deliverNotifications } from './notifications.js';
import { createRateLimiter } from './rateLimiter.js';

export const MAX_MESSAGE_LENGTH = 1000;
const TELEGRAM_LIMIT = 4096;

export const HELP_TEXT = `Puedo ayudarte a llevar tus finanzas. Escríbeme normal, por ejemplo:

• "Gasté 45.000 en una cena" (comida)
• "Me pagaron 500.000 por una venta"
• "Pagué el arriendo"
• "¿Cuánto me queda este mes?"
• "¿Qué facturas tengo pendientes?"
• "Gastos de los últimos 3 días"
• "Gastos por categoría"
• "Pon mi límite mensual en 600.000"
• "Mi salario es 3.500.000 y me pagan el día 1"

Categorías: salidas, comida, transporte, emergencias y lujo.
Te aviso cuando llegues al 80 % y al 100 % de tu límite, y te envío el resumen al cerrar cada mes.`;

/** Parte un texto largo en trozos que Telegram acepta. */
export function splitMessage(text, size = TELEGRAM_LIMIT) {
  const parts = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size / 2) cut = size;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) parts.push(rest);
  return parts;
}

/**
 * Lógica de un mensaje entrante, independiente de grammY para poder probarla.
 * Devuelve el texto a responder o null si el mensaje se ignora.
 */
export function createMessageHandler({
  orchestrator,
  allowedUserIds,
  history = createHistory(20),
  rateLimiter = createRateLimiter({ max: 20, windowMs: 60_000 }),
  logger
}) {
  const allowed = new Set(allowedUserIds);

  return async function handleMessage({ userId, chatId, text }) {
    if (!allowed.has(userId)) {
      logger?.warn({ telegram_user_id: userId }, 'mensaje de usuario no permitido');
      return null;
    }
    if (!rateLimiter(userId)) {
      return 'Vas muy rápido 🙂. Espera un momento y vuelve a escribirme.';
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      return `Tu mensaje es muy largo (máximo ${MAX_MESSAGE_LENGTH} caracteres). ¿Me lo resumes?`;
    }

    const started = Date.now();
    try {
      const result = await orchestrator.reply({ history: history.get(chatId), text });
      history.addTurn(
        chatId,
        result.messages ?? [{ role: 'user', content: text }, { role: 'assistant', content: result.text }]
      );
      logger?.info(
        {
          chat_id: chatId,
          tools: result.toolCalls.map((c) => (c.ok ? c.name : `${c.name}:error`)),
          corrections: result.corrections ?? [],
          duration_ms: Date.now() - started
        },
        'mensaje atendido'
      );
      return result.text;
    } catch (error) {
      logger?.error({ err: error, chat_id: chatId }, 'error atendiendo el mensaje');
      return 'Tuve un problema para procesar tu mensaje. Intenta de nuevo en un momento.';
    }
  };
}

/**
 * Bot de Telegram con long polling. Entrega notificaciones al terminar cada
 * turno, al arrancar y periódicamente (para el cierre de las 00:05).
 */
export function createTelegramBot({
  token,
  allowedUserIds,
  orchestrator,
  api,
  logger,
  pollNotificationsMs = 60_000,
  BotClass = Bot
}) {
  const bot = new BotClass(token);
  const handleMessage = createMessageHandler({ orchestrator, allowedUserIds, logger });
  const allowed = new Set(allowedUserIds);
  let timer = null;

  const send = async (chatId, text) => {
    for (const part of splitMessage(text)) await bot.api.sendMessage(chatId, part);
  };

  const flush = () =>
    deliverNotifications({ api, send, chatIds: allowedUserIds, logger }).catch((error) => {
      logger?.error({ err: error }, 'error entregando notificaciones');
      return 0;
    });

  bot.command(['start', 'ayuda', 'help'], async (ctx) => {
    if (!allowed.has(ctx.from?.id)) return;
    const hello = ctx.message?.text?.startsWith('/start') ? '¡Hola! ' : '';
    await ctx.reply(`${hello}${HELP_TEXT}`);
  });

  bot.on('message:text', async (ctx) => {
    if (!allowed.has(ctx.from?.id)) {
      logger?.warn({ telegram_user_id: ctx.from?.id }, 'mensaje de usuario no permitido');
      return;
    }
    await ctx.replyWithChatAction('typing').catch(() => {});
    const answer = await handleMessage({ userId: ctx.from.id, chatId: ctx.chat.id, text: ctx.message.text });
    if (answer) await send(ctx.chat.id, answer);
    await flush();
  });

  bot.catch((error) => logger?.error({ err: error.error ?? error }, 'error en el bot de Telegram'));

  return {
    bot,
    send,
    deliverNotifications: flush,
    async notifyOwner(text) {
      for (const chatId of allowedUserIds) await send(chatId, text).catch(() => {});
    },
    start() {
      // Un token inválido rechaza la promesa: se registra sin tumbar la API.
      Promise.resolve(
        bot.start({
          drop_pending_updates: false,
          onStart: (info) => logger?.info({ username: info.username }, 'bot de Telegram iniciado')
        })
      ).catch((error) => logger?.error({ err: error }, 'el bot de Telegram se detuvo'));
      flush();
      timer = setInterval(flush, pollNotificationsMs);
      timer.unref?.();
    },
    async stop() {
      if (timer) clearInterval(timer);
      await bot.stop();
    }
  };
}

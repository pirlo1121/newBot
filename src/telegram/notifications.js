/**
 * Entrega la outbox: lee pendientes por la API, las envía a cada chat
 * permitido y las marca entregadas. El texto lo redactó el backend (D-12).
 * Si el envío falla, la notificación queda pendiente para el siguiente intento.
 */
export async function deliverNotifications({ api, send, chatIds, logger }) {
  if (chatIds.length === 0) return 0;
  const pending = await api.get('/api/notifications/pending');
  if (!pending.ok) {
    logger?.warn({ code: pending.error?.code }, 'no se pudieron leer las notificaciones pendientes');
    return 0;
  }

  let delivered = 0;
  for (const notification of pending.data.items) {
    try {
      for (const chatId of chatIds) await send(chatId, notification.text);
    } catch (error) {
      logger?.error({ err: error, notification_id: notification.id }, 'falló el envío de la notificación');
      break;
    }
    const ack = await api.post(`/api/notifications/${notification.id}/ack`);
    if (ack.ok) delivered += 1;
  }
  return delivered;
}

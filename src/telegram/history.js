/** Historial corto por chat, en memoria (AGENTS.md §4: 20 mensajes). */
export function createHistory(maxMessages = 20) {
  const chats = new Map();
  return {
    get: (chatId) => [...(chats.get(chatId) ?? [])],
    add(chatId, ...messages) {
      const list = [...(chats.get(chatId) ?? []), ...messages];
      chats.set(chatId, list.slice(-maxMessages));
    },
    clear: (chatId) => chats.delete(chatId)
  };
}

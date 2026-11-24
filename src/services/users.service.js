import { createUser, findOwner, setTelegramUserId } from '../repositories/users.repository.js';

/**
 * El producto es de un solo usuario (AGENTS.md §2.2): el dueño es la
 * primera fila de `users`. Se crea con el primer ID de Telegram permitido.
 */
export function ensureOwner(db, telegramUserId = 0) {
  const owner = findOwner(db);
  if (!owner) return createUser(db, telegramUserId);
  if (owner.telegram_user_id === 0 && telegramUserId) {
    setTelegramUserId(db, owner.id, telegramUserId);
    return { ...owner, telegram_user_id: telegramUserId };
  }
  return owner;
}

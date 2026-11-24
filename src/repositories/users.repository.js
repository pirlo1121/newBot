export const findOwner = (db) =>
  db.prepare('SELECT * FROM users ORDER BY id LIMIT 1').get();

export const createUser = (db, telegramUserId, name = null) =>
  db
    .prepare('INSERT INTO users (telegram_user_id, name) VALUES (?, ?) RETURNING *')
    .get(telegramUserId, name);

export const setTelegramUserId = (db, userId, telegramUserId) =>
  db.prepare('UPDATE users SET telegram_user_id = ? WHERE id = ?').run(telegramUserId, userId);

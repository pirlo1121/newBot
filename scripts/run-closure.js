import 'dotenv/config';

import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { formatCop } from '../src/domain/money.js';
import { ensureClosures } from '../src/services/closure.service.js';
import { createServiceContext } from '../src/services/context.js';
import { ensureOwner } from '../src/services/users.service.js';

/** Cierre manual e idempotente. Uso: npm run closure:run [-- --dry-run] */
const dryRun = process.argv.includes('--dry-run');
const config = loadConfig(process.env);
const db = openDatabase(config.dbPath);
migrate(db);
const ctx = createServiceContext({ db, timezone: config.timezone });
const owner = ensureOwner(db, config.allowedTelegramUserIds[0] ?? 0);

const results = ensureClosures(ctx, owner.id, { dryRun });
if (results.length === 0) {
  console.log('No hay cierres vencidos.');
} else {
  for (const item of results) {
    console.log(
      `${dryRun ? '[simulación] ' : ''}${item.period}: saldo ${formatCop(item.balance_cents)}, ahorro ${formatCop(item.saved_cents)}`
    );
  }
}
db.close();

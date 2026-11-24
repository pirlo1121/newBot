import 'dotenv/config';

import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { transaction } from '../src/db/transaction.js';
import { activePeriod, createServiceContext } from '../src/services/context.js';
import { createExpense } from '../src/services/expenses.service.js';
import { createTemplate } from '../src/services/fixedExpenses.service.js';
import { setMonthlyLimit } from '../src/services/limits.service.js';
import { ensurePeriod } from '../src/services/periods.service.js';
import { setSalary } from '../src/services/salary.service.js';
import { ensureOwner } from '../src/services/users.service.js';

/**
 * Datos de desarrollo reproducibles. Si ya existe información no hace nada,
 * así una segunda ejecución no duplica nada.
 */
const config = loadConfig(process.env);
if (config.nodeEnv === 'production' && !process.argv.includes('--force')) {
  console.error('El seed no se ejecuta en producción (usa --force si de verdad lo quieres).');
  process.exit(1);
}

const db = openDatabase(config.dbPath);
migrate(db);
const ctx = createServiceContext({ db, timezone: config.timezone });
const owner = ensureOwner(db, config.allowedTelegramUserIds[0] ?? 0);

const hasData = db.prepare('SELECT COUNT(*) AS n FROM salary_history WHERE user_id = ?').get(owner.id).n > 0;
if (hasData) {
  console.log('La base ya tiene datos; no se cargó el seed.');
} else {
  transaction(db, () => {
    ensurePeriod(ctx, owner.id, activePeriod(ctx));
    setSalary(ctx, owner.id, { amountCents: 350_000_000, payDay: 1 }); // $3.500.000
    createTemplate(ctx, owner.id, { name: 'Arriendo', amountCents: 90_000_000, dueDay: 1 }); // $900.000
    createTemplate(ctx, owner.id, { name: 'Crédito', amountCents: 20_000_000, dueDay: 10 }); // $200.000
    setMonthlyLimit(ctx, owner.id, 60_000_000); // $600.000
    createExpense(ctx, owner.id, { name: 'Almuerzo', amountCents: 2_500_000, category: 'comida' }); // $25.000
    createExpense(ctx, owner.id, { name: 'Taxi', amountCents: 1_800_000, category: 'transporte' }); // $18.000
  });
  console.log('Seed cargado: salario, 2 gastos fijos, límite y 2 gastos extras.');
}
db.close();

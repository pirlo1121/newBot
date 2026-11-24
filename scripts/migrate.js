import 'dotenv/config';

import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';

const config = loadConfig(process.env);
const db = openDatabase(config.dbPath);
const applied = migrate(db);
db.close();

console.log(
  applied.length
    ? `Migraciones aplicadas: ${applied.join(', ')}`
    : 'La base ya estaba al día.'
);

/** Ensure the DB schema exists (pglite dev or prod Postgres). `npm run db:init`. */
import { config } from '../src/config.js';
import { getDb, ensureSchema } from '../src/db/index.js';

const db = await getDb(config);
await ensureSchema(db);
console.log(`[db:init] schema ensured (${config.db.url ? 'postgres' : 'pglite:' + config.db.pgliteDir})`);
process.exit(0);

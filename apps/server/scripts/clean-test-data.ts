/**
 * Remove synthetic self-test reports (dryrun/smoke/tune walks) from the configured DB.
 * Safe: only deletes walks whose id matches a known test prefix; observations + photos
 * cascade. Runs against whatever DATABASE_URL is set (prod Neon when .env is present).
 *   npm run clean:test -w @fieldreport/server
 */
import { like, or } from 'drizzle-orm';
import { config } from '../src/config.js';
import { getDb } from '../src/db/index.js';
import { reports } from '../src/db/schema.js';

const db = await getDb(config);
const patterns = ['dryrun-%', 'smoke-%', 'smoke-walk-%', 'tune-%', 'e2e-%'];

const deleted = await db
  .delete(reports)
  .where(or(...patterns.map((p) => like(reports.walkId, p))))
  .returning({ id: reports.id, walkId: reports.walkId });

console.log(
  `[clean] db=${config.db.url ? 'postgres' : 'pglite'} — deleted ${deleted.length} test report(s):`,
  deleted.map((r) => r.walkId),
);
process.exit(0);

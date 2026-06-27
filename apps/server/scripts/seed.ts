/** Seed the single pilot project (idempotent). `npm run seed`. */
import { config } from '../src/config.js';
import { buildDeps } from '../src/deps.js';

await buildDeps(config); // ensures schema + upserts the pilot project
console.log(`[seed] pilot project ready: ${config.pilot.projectId} (${config.pilot.projectName})`);
process.exit(0);

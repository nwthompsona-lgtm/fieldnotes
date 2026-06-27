/**
 * Server entrypoint. Builds deps (db + storage + providers, seeds pilot project),
 * starts Fastify, and shuts down cleanly (closing the Playwright browser).
 */
import { config } from './config.js';
import { buildDeps } from './deps.js';
import { buildApp } from './app.js';
import { closeBrowser } from './render/index.js';

const deps = await buildDeps(config);
const app = await buildApp(deps);

await app.listen({ port: config.port, host: config.host });
app.log.info(
  `FieldReport server up · storage=${deps.storage.name} stt=${deps.transcriber.name} synthesis=${deps.synthesizer.name}`,
);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info(`${sig} received, shutting down`);
    await app.close();
    await closeBrowser();
    process.exit(0);
  });
}

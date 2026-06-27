/**
 * Fastify assembly. CORS open (pilot; capture + web are separate origins), multipart
 * tuned for a ~30-observation walk (many photo parts + audio parts).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { registerRoutes } from './routes.js';
import type { ServerDeps } from './deps.js';

export async function buildApp(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 8 * 1024 * 1024, // JSON bodies (edits) only; media goes via multipart
  });

  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: 40 * 1024 * 1024, // per file (a single photo/audio clip)
      files: 4000, // ~30 obs * (photos + audio), generous headroom
      fieldSize: 8 * 1024 * 1024, // the manifest JSON field
      fields: 20,
    },
  });

  registerRoutes(app, deps);
  return app;
}

/**
 * Fastify assembly. CORS: allowlist from CORS_ALLOWED_ORIGINS when set (the Vercel
 * capture + web origins, auth plan §11), else permissive origin:true for local dev.
 * Multipart tuned for a ~30-observation walk (many photo parts + audio parts).
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { registerRoutes } from './routes.js';
import { registerAuthContext } from './auth/context.js';
import type { ServerDeps } from './deps.js';

export async function buildApp(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 8 * 1024 * 1024, // JSON bodies (edits) only; media goes via multipart
  });

  // No credentials mode needed: auth is a bearer header, not cookies (T-1).
  const allowedOrigins = deps.config.cors.allowedOrigins;
  await app.register(cors, {
    origin: allowedOrigins.length ? allowedOrigins : true,
  });
  await app.register(multipart, {
    limits: {
      fileSize: 40 * 1024 * 1024, // per file (a single photo/audio clip)
      files: 4000, // ~30 obs * (photos + audio), generous headroom
      fieldSize: 8 * 1024 * 1024, // the manifest JSON field
      fields: 20,
    },
  });

  // Resolves Authorization: Bearer <session> into req.auth on every request (null when
  // absent/invalid — never rejects; route guards are opt-in via requireAuth).
  registerAuthContext(app, deps);

  registerRoutes(app, deps);
  return app;
}

/**
 * Runtime config + provider selection (spec §7 local-dev story). Real providers
 * activate when their keys are present; otherwise deterministic mocks run so the whole
 * pipeline works offline with no accounts. Everything is env-driven.
 */
import 'dotenv/config';

function bool(v: string | undefined, dflt = false): boolean {
  if (v == null) return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

const env = process.env;

/** Force embedded pglite + local-disk storage even when prod DATABASE_URL/S3_BUCKET are
 *  present — so self-tests (dryrun) never touch the pilot's real Neon DB / R2 bucket. */
const forceLocal = bool(env.FIELDREPORT_LOCAL);

export const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '0.0.0.0',
  /** Absolute base used to build htmlUrl/pdfUrl + media URLs. Falls back to Render's
   *  auto-injected RENDER_EXTERNAL_URL so no manual PUBLIC_BASE_URL/redeploy is needed. */
  publicBaseUrl: (
    env.PUBLIC_BASE_URL ??
    env.RENDER_EXTERNAL_URL ??
    `http://localhost:${env.PORT ?? 8787}`
  ).replace(/\/$/, ''),

  db: {
    /** When set -> prod Postgres (Neon). When unset (or FIELDREPORT_LOCAL) -> pglite. */
    url: forceLocal ? undefined : env.DATABASE_URL,
    pgliteDir: env.PGLITE_DIR ?? '.data/pglite',
  },

  storage: {
    /** 's3' when S3_BUCKET present (works for S3 or Cloudflare R2), else 'local'. */
    driver: (forceLocal ? 'local' : env.S3_BUCKET ? 's3' : 'local') as 's3' | 'local',
    localDir: env.STORAGE_DIR ?? '.data/storage',
    s3: {
      bucket: env.S3_BUCKET,
      region: env.S3_REGION ?? 'auto',
      endpoint: env.S3_ENDPOINT, // R2: https://<acct>.r2.cloudflarestorage.com
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      publicBaseUrl: env.S3_PUBLIC_BASE_URL, // optional CDN/public bucket base
    },
  },

  stt: {
    /** 'deepgram' when key present, else 'mock'. STT_PROVIDER forces either (handy for
     *  prompt tuning: mock STT supplies the curated corpus while synthesis stays real). */
    provider: ((env.STT_PROVIDER as 'deepgram' | 'mock' | undefined) ??
      (env.DEEPGRAM_API_KEY ? 'deepgram' : 'mock')) as 'deepgram' | 'mock',
    deepgramApiKey: env.DEEPGRAM_API_KEY,
    // nova-3 gets the better `keyterm` prompting path (deepgram.ts) for domain vocabulary;
    // nova-2 only had legacy `keywords` boosting. Override with DEEPGRAM_MODEL if needed.
    model: env.DEEPGRAM_MODEL ?? 'nova-3',
    language: env.STT_LANGUAGE ?? 'en-US',
  },

  synthesis: {
    /** 'claude' when key present, else 'mock'. SYNTHESIS_PROVIDER forces either. */
    provider: ((env.SYNTHESIS_PROVIDER as 'claude' | 'mock' | undefined) ??
      (env.ANTHROPIC_API_KEY ? 'claude' : 'mock')) as 'claude' | 'mock',
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    // Synthesis model. Default Sonnet 4.6 for lower cost/latency (user's call, D12);
    // set ANTHROPIC_MODEL=claude-opus-4-8 to go back to the most capable model.
    model: env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6',
    maxTokens: Number(env.ANTHROPIC_MAX_TOKENS ?? 8192),
  },

  langsmith: {
    enabled: bool(env.LANGCHAIN_TRACING_V2) || bool(env.LANGSMITH_TRACING),
    apiKey: env.LANGSMITH_API_KEY ?? env.LANGCHAIN_API_KEY,
    project: env.LANGCHAIN_PROJECT ?? env.LANGSMITH_PROJECT ?? 'fieldreport',
  },

  cors: {
    /** Allowlist of SPA origins (capture + web), comma-separated in CORS_ALLOWED_ORIGINS.
     *  Empty => permissive `origin:true` for local dev. Parsed here in Phase 0; the actual
     *  @fastify/cors swap (allowlist when set, else origin:true) lands in Phase 3 (auth core). */
    allowedOrigins: (env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  admin: {
    /** Bearer token gating /api/admin/*. Generated/required for prod. */
    token: env.ADMIN_TOKEN ?? 'dev-admin-token',
  },

  /** The single pilot project (spec §12: single super, single project). */
  pilot: {
    projectId: env.PILOT_PROJECT_ID ?? 'pilot-project',
    projectName: env.PILOT_PROJECT_NAME ?? 'Watson Island',
    superName: env.PILOT_SUPER_NAME ?? 'Pilot Super',
  },
} as const;

export type AppConfig = typeof config;

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

/** Parse a non-negative number env, failing CLOSED: a malformed value (e.g. "30d")
 *  throws at boot instead of silently degrading (NaN > 0 is false, which would have
 *  turned a configured session TTL into "never expires"). */
function nonNegativeNumber(name: string, v: string | undefined, dflt: number): number {
  if (v == null || v.trim() === '') return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${name} must be a non-negative number, got ${JSON.stringify(v)}`);
  }
  return n;
}

const env = process.env;

/** Force embedded pglite + local-disk storage even when prod DATABASE_URL/S3_BUCKET are
 *  present — so self-tests (dryrun) never touch the pilot's real Neon DB / R2 bucket. */
const forceLocal = bool(env.FIELDREPORT_LOCAL);

export const config = {
  port: Number(env.PORT ?? 8787),
  host: env.HOST ?? '0.0.0.0',
  /** True on Render (it injects RENDER=true) — used to fail fast on configs that are
   *  survivable locally but destructive on an ephemeral container (e.g. no DATABASE_URL
   *  silently meaning pglite-on-container-disk: every deploy would wipe all data). */
  isRender: bool(env.RENDER),
  /** The explicit local/hermetic switch (also forces pglite + local storage below). */
  forceLocal,
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

  auth: {
    /** Session lifetime in days; 0 = indefinite (`expires_at = null`, revoke-only) per D-2.
     *  Malformed values throw at boot rather than silently meaning "never expires". */
    sessionTtlDays: nonNegativeNumber('SESSION_TTL_DAYS', env.SESSION_TTL_DAYS, 0),
  },

  email: {
    /** 'resend' when key present, else 'mock' (writes under .data + logs), mirroring the
     *  STT/synthesis provider pattern. EMAIL_PROVIDER forces either. */
    provider: ((env.EMAIL_PROVIDER as 'resend' | 'mock' | undefined) ??
      (env.RESEND_API_KEY ? 'resend' : 'mock')) as 'resend' | 'mock',
    resendApiKey: env.RESEND_API_KEY,
    from: env.EMAIL_FROM ?? 'FieldReport <reports@fieldreport.app>',
  },

  app: {
    /** Web SPA base for invite-accept links (§10). Distinct from publicBaseUrl (the API
     *  origin): invite links land on the web app, share links land on the server's /s.
     *  A BLANK env var (how dashboards store an empty prompt) must behave like unset —
     *  '' would slip past the ?? fallback and mint relative /accept links in emails. */
    webBaseUrl: env.WEB_BASE_URL?.trim() ? env.WEB_BASE_URL.trim().replace(/\/$/, '') : undefined,
  },

  cors: {
    /** Allowlist of SPA origins (capture + web), comma-separated in CORS_ALLOWED_ORIGINS.
     *  Empty => permissive `origin:true` for local dev; when set, app.ts feeds it to
     *  @fastify/cors, which compares against the browser's Origin header with exact ===.
     *  So normalize what browsers actually send: strip trailing slashes (an Origin header
     *  never has one) and lowercase (scheme+host are case-insensitive). A stray slash in
     *  the env var must not silently break every capture upload. */
    allowedOrigins: (env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
      .filter(Boolean),
  },

  admin: {
    /** Static bearer token. Since Phase 4, /api/admin/* is gated by org-admin sessions;
     *  this token only works as a break-glass superadmin when ADMIN_BREAK_GLASS is on. */
    token: env.ADMIN_TOKEN ?? 'dev-admin-token',
    /** Off by default (auth plan §15.3): enable for ops/debugging to let the static
     *  token see ALL orgs. */
    breakGlass: bool(env.ADMIN_BREAK_GLASS),
  },

  /** Pilot bootstrap (auth plan §12): the boot seed upserts this org, creates the admin
   *  user (email+password), adopts org-less projects, and backfills report authorship. */
  pilot: {
    projectId: env.PILOT_PROJECT_ID ?? 'pilot-project',
    projectName: env.PILOT_PROJECT_NAME ?? 'Watson Island',
    superName: env.PILOT_SUPER_NAME ?? 'Pilot Super',
    orgId: env.PILOT_ORG_ID ?? 'org_pilot',
    orgName: env.PILOT_ORG_NAME ?? 'Watson Builders',
    superEmail: env.PILOT_SUPER_EMAIL,
    superPassword: env.PILOT_SUPER_PASSWORD,
  },
} as const;

export type AppConfig = typeof config;

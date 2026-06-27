# FieldReport — Deploy & Run

Three deployables + managed Postgres + object storage. HTTPS is mandatory (PWA install +
camera + mic need a secure context). See `KEYS_CHECKLIST.md` for the account/key steps;
this file is the mechanics.

```
apps/capture  → static host (Vercel/Netlify)   the super's offline PWA
apps/web      → static host (Vercel/Netlify)   review-before-send + admin
apps/server   → container host (Render/Fly)    API + storage + STT + synthesis + PDF
Postgres      → Neon         Object storage → Cloudflare R2 (or S3)
```

---

## Local (no accounts — mock providers)

```bash
npm install
npm run build:contracts
npm run dryrun            # end-to-end synthetic walk → apps/server/dryrun-output/{report.html,report.pdf}
npm run dev:server        # http://localhost:8787   (pglite + local-disk + mock STT/LLM)
npm run dev:capture       # http://localhost:5173 (or 5180)
npm run dev:web           # review at /review/:id, admin at /admin
```
With `ANTHROPIC_API_KEY` / `DEEPGRAM_API_KEY` set (in `apps/server/.env`), the same commands
use real Claude + Deepgram. `/healthz` reports which providers are live.

> Windows note (this machine): Node is portable. Prefix commands with
> `$env:Path = 'C:\Users\NickThompson\tools\node-v22.12.0-win-x64;' + $env:Path`.

---

## Server (Render, Docker)

The server needs Chromium for PDF rendering, so it ships a Dockerfile built on the official
Playwright image. **Build context is the repo root** (it needs the contracts workspace):

```bash
docker build -f apps/server/Dockerfile -t fieldreport-server .
docker run -p 8787:8787 --env-file apps/server/.env fieldreport-server
```

On Render: New → Web Service → Docker → Dockerfile `apps/server/Dockerfile`, context `.`,
set the env vars from `KEYS_CHECKLIST.md`, deploy, then set `PUBLIC_BASE_URL` to the resulting
URL and redeploy. The schema is created and the pilot project seeded automatically on boot.

Fly.io alternative: `fly launch --dockerfile apps/server/Dockerfile` (no fly.toml committed;
generate one and set the same env/secrets).

---

## Observability (LangSmith) — optional

Synthesis (and the per-report pipeline) are wired with LangSmith `traceable`, a no-op until
enabled. To monitor runs / troubleshoot prod, set these env vars on the Render service and
redeploy (the server picks them up at boot — no code change):

| Var | Value |
|---|---|
| `LANGSMITH_TRACING` | `true` (or `LANGCHAIN_TRACING_V2=true`) |
| `LANGSMITH_API_KEY` | your LangSmith key (`lsv2_...`) — create at smith.langchain.com → Settings → API Keys (also accepts `LANGCHAIN_API_KEY`) |
| `LANGSMITH_PROJECT` | `fieldreport` (optional; defaults to `fieldreport`; also accepts `LANGCHAIN_PROJECT`) |

Each synthesized report then appears in the LangSmith **fieldreport** project as a
`fieldreport.report` trace with the `fieldreport.synthesize` call nested under it (you see the
transcripts in and the polished JSON out, per report). Without `LANGSMITH_TRACING` set it stays
off and costs nothing.

## Capture + Web (Vercel)

Two separate Vercel projects from the same repo:

| Project | Root Directory | Env |
|---|---|---|
| capture | `apps/capture` | `VITE_API_BASE`=<server URL>, `VITE_WEB_BASE`=<web URL> |
| web | `apps/web` | `VITE_API_BASE`=<server URL> |

> The preparer name and project are now entered by the user at report time (Review & Sync
> screen) and remembered on-device — they are **no longer** baked via `VITE_SUPER_NAME` /
> `VITE_PROJECT_ID`. `VITE_WEB_BASE` lets the capture app link to the review page after Sync.

Both are Vite SPAs (build `npm run build`, output `dist`). Vite bakes `VITE_*` at build time, so
set them before deploying and redeploy if the server URL changes.

> **Deploy order (since contracts 1.1.0): server FIRST, then capture.** A v1.1.0 capture upload
> carries a fresh, non-seeded `projectId` (a slug of the typed project name). An older server
> that lacks `ensureProjectFromUpload` would reject it on the `reports.project_id → projects.id`
> foreign key (HTTP 500), and the walk would stay stuck `pending` until the server catches up
> (no data loss — it re-syncs once the server is current). So: push `master` (Render
> auto-deploys), confirm `GET /healthz` shows the new `commit`, **then** publish the capture
> build on Vercel. The reverse direction (old capture → new server) is safe. For the SPA routes
(`/review/:id`, `/admin/:id`) ensure the host rewrites unknown paths to `index.html`
(Vercel/Netlify do this for Vite by default; add a catch-all rewrite if not).

---

## Verify after deploy (the §10 checklist, in prod)

1. `GET https://<server>/healthz` → `{ ok:true, storage:"s3", stt:"deepgram", synthesis:"claude" }`.
2. Open the capture URL on the pilot iPhone → install to Home Screen → capture a few offline → Sync.
3. Open the review link → confirm it processes to a draft → edit → Finalize → open hosted HTML + PDF.
4. Open `https://<web>/admin` (paste `ADMIN_TOKEN`) → see raw photos + transcripts beside polished output.

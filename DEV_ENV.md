# Dev / staging environment — runbook

Status: **Phase 0.** The repo side is done (on `develop`). The dashboard steps below are
yours to do — I can't click Render/Neon/Vercel UIs or handle credentials. Companion docs:
`AUTH_MULTITENANCY_PLAN.md` §14.2–§14.3 (why), `DEPLOY.md` (prod mechanics this mirrors).

## Why a separate dev environment

The auth + multi-tenancy work is a **breaking schema migration**. It must never touch the
live pilot's data. So dev/staging gets its **own** server, **own** Neon database, and **own**
R2 bucket — a full isolated twin of prod that deploys from the `develop` branch. Production
(`master`, `fieldreport-server` at `https://fieldnotes-yglr.onrender.com`) is left untouched.
We promote `develop → master` only when you say so.

| | Production (LIVE — untouched) | Dev / staging (NEW — build here) |
|---|---|---|
| Branch | `master` | `develop` |
| Server | Render `fieldreport-server` | Render `fieldreport-server-dev` (`render.dev.yaml`) |
| Database | Neon (prod) | **separate** Neon `fieldreport-dev` |
| Storage | R2 (prod) | **separate** R2 `fieldreport-media-dev` |
| Web / capture | Vercel prod projects | Vercel `*-dev` projects |

## What I already did (repo side, on `develop`)

- Cut the **`develop`** branch from `master`.
- Added **`render.dev.yaml`** — the dev Render blueprint (service `fieldreport-server-dev`,
  `branch: develop`, all secrets `sync:false`).
- Added **`apps/server/.env.dev.example`**, **`apps/capture/.env.dev.example`**,
  **`apps/web/.env.dev.example`** — the env templates the tables below come from.
- Added **`cors.allowedOrigins`** to `apps/server/src/config.ts` (parsed from
  `CORS_ALLOWED_ORIGINS`; harmless until Phase 3 wires it into CORS).

---

## Your dashboard steps (in order)

The order matters: the server needs the DB + bucket before it can boot healthy; the Vercel
apps need the server URL; then the server's CORS list needs the Vercel URLs. There's a
deliberate "leave CORS unset first, fill it in last" loop to break the chicken-and-egg.

### 1. Neon — create the dev database

1. Neon console → create a new **project** (cleanest isolation) or a **branch** named
   `fieldreport-dev`.
2. Copy its pooled connection string (`postgres://…?sslmode=require`).
3. **Hold it** for `DATABASE_URL` in step 3. Leave it empty — the server creates the schema
   and seeds on first boot. **Do not reuse the prod connection string.**

### 2. Cloudflare R2 — create the dev bucket

1. R2 → **Create bucket** → `fieldreport-media-dev`.
2. Create an **API token** scoped to that bucket → copy Access Key ID + Secret Access Key.
3. Note the S3 endpoint `https://<account>.r2.cloudflarestorage.com`.
4. **Hold these** for the `S3_*` vars in step 3. **Do not reuse the prod bucket or keys.**

### 3. Render — create the dev server

1. Render → **New → Blueprint** → pick this repo → choose **`render.dev.yaml`**
   (not `render.yaml`). It creates `fieldreport-server-dev` on branch `develop`.
   (If Blueprint is awkward: New → **Web Service** → Docker, Dockerfile
   `apps/server/Dockerfile`, context `.`, branch `develop`, health check `/healthz`.)
2. Paste the env values it prompts for (the `sync:false` ones) — see the table below.
   **Leave `CORS_ALLOWED_ORIGINS` blank for now** (we set it in step 5).
3. Deploy. When it's live, copy the service URL → this is **`<DEV_SERVER_URL>`**
   (e.g. `https://fieldreport-server-dev.onrender.com`).
4. Check `GET <DEV_SERVER_URL>/healthz` → `{ ok: true, … }`.

**Render env (`fieldreport-server-dev`):**

| Var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | dev Neon string (step 1) | **dev only**, never prod |
| `S3_BUCKET` | `fieldreport-media-dev` | |
| `S3_ENDPOINT` | `https://<account>.r2.cloudflarestorage.com` | |
| `S3_REGION` | `auto` | preset in blueprint |
| `S3_ACCESS_KEY_ID` | dev R2 key (step 2) | **dev only** |
| `S3_SECRET_ACCESS_KEY` | dev R2 secret (step 2) | **dev only** |
| `ADMIN_TOKEN` | a fresh dev-only random string | not the prod token |
| `SESSION_TTL_DAYS` | `0` | preset; 0 = indefinite |
| `CORS_ALLOWED_ORIGINS` | *(blank for now)* | set in step 5 |
| `ANTHROPIC_API_KEY` | *(optional)* | blank → mock synthesis |
| `DEEPGRAM_API_KEY` | *(optional)* | blank → mock STT |
| `RESEND_API_KEY` | *(blank until Phase 5/8)* | blank → mock email |
| `EMAIL_FROM` | `FieldReport (dev) <reports@fieldreport.app>` | preset |
| `WEB_BASE_URL` | *(set in step 5)* | web-dev URL, for invite links |
| `PILOT_ORG_ID` | `org_pilot_dev` | preset |
| `PILOT_ORG_NAME` | `Watson Builders (dev)` | preset |
| `PILOT_PROJECT_NAME` | `Watson Island` | preset |
| `PILOT_SUPER_NAME` | e.g. `Jake Romero` | your dev super's display name |
| `PILOT_SUPER_EMAIL` | your email | used at Phase 4 to log in as dev admin |
| `PILOT_SUPER_PASSWORD` | a one-time dev password | rotate after first login |

> `PILOT_SUPER_EMAIL/PASSWORD`, `RESEND_API_KEY`, `WEB_BASE_URL` aren't consumed until later
> phases — fine to leave blank now and fill them when those phases land.

### 4. Vercel — create the two dev SPA projects

For **each** of capture and web, New Project → import this repo →

| Project | Root Directory | Production Branch | Env |
|---|---|---|---|
| `fieldreport-capture-dev` | `apps/capture` | `develop` | `VITE_API_BASE=<DEV_SERVER_URL>`, `VITE_WEB_BASE=<web-dev URL>` |
| `fieldreport-web-dev` | `apps/web` | `develop` | `VITE_API_BASE=<DEV_SERVER_URL>` |

- Set Production Branch to **`develop`** (Project → Settings → Git) so dev pushes deploy here.
- `VITE_*` are baked at build time — redeploy if `<DEV_SERVER_URL>` ever changes.
- Deploy both, then copy the two resulting URLs (capture-dev, web-dev).
- (`VITE_WEB_BASE` is the web-dev URL; you'll know it after web-dev's first deploy. Set it on
  capture-dev and redeploy capture-dev.)

### 5. Close the loop — set CORS + web base on the server

1. Back on Render `fieldreport-server-dev`, set:
   - `CORS_ALLOWED_ORIGINS` = `<capture-dev URL>,<web-dev URL>` (comma-separated, no spaces).
   - `WEB_BASE_URL` = `<web-dev URL>`.
2. Redeploy the dev server. (Until Phase 3 wires the allowlist, CORS stays permissive
   regardless — this just front-loads the value so Phase 3 "just works" on dev.)

---

## Verify

- `GET <DEV_SERVER_URL>/healthz` → `ok: true`, `commit` = `develop` HEAD, `storage: "s3"`.
- Confirm the dev server's `DATABASE_URL`/`S3_BUCKET` are the **dev** ones (not prod) — this
  is the one thing that must never be wrong.
- Open capture-dev and web-dev in a browser; confirm they load and reach `<DEV_SERVER_URL>`
  (network tab shows calls to the dev server, no CORS error).

## Guardrails

- **Never** point `fieldreport-server-dev` at the prod Neon DB or prod R2 bucket.
- **Never** merge `develop → master` as part of standing up dev. Prod promotion is a separate,
  explicit step you trigger at the Phase 4 / Phase 8 milestones.
- Prod (`render.yaml`, `fieldreport-server`, `master`) is not edited by any of this.

---

## What I need from you to finish standing up the dev server

1. **Do the 5 dashboard steps above** (Neon → R2 → Render → Vercel → CORS loop).
2. **Send me back these three URLs** so I can record them in `AUTH_MULTITENANCY_PLAN.md`
   and target milestone deploys:
   - `<DEV_SERVER_URL>` (Render)
   - capture-dev URL (Vercel)
   - web-dev URL (Vercel)
3. **Secrets stay in the dashboards** — paste dev `DATABASE_URL`, `S3_*` keys, `ADMIN_TOKEN`,
   and `PILOT_SUPER_PASSWORD` directly into Render. **Don't paste any secret into chat;** I
   only need the public URLs.

Phases 1–3 are local-first (pglite + mocks) and don't need the dev server, so I can start
Phase 1 immediately — the dev server just needs to exist before the Phase 4 milestone deploy.

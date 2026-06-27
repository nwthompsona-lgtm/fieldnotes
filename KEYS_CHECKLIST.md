# FieldReport — Accounts & Keys Checklist (Checkpoint B)

Do this **once, in one sitting.** I cannot create accounts or handle your keys, so this is
the one batched handoff. Everything below is deploy-ready; you create the accounts, paste
the keys, and deploy. Times are rough.

> The app runs **fully locally with zero keys** for testing (`npm run dryrun`, `npm run dev:*`)
> — mock transcription + mock synthesis. You only need the keys below to (a) use the real
> Deepgram/Claude quality and (b) put it on a public HTTPS URL the super can install on a phone.

---

## A. The 5 accounts to create

| # | Service | Why | What you'll copy out |
|---|---------|-----|----------------------|
| 1 | **Anthropic** (console.anthropic.com) | Synthesis — the report-writing IP | `ANTHROPIC_API_KEY` |
| 2 | **Deepgram** (console.deepgram.com) | Transcription with construction vocab biasing | `DEEPGRAM_API_KEY` |
| 3 | **Neon** (neon.tech) — managed Postgres | Report/observation data | `DATABASE_URL` |
| 4 | **Cloudflare R2** (dash.cloudflare.com → R2) *or* AWS S3 | Photos, audio, rendered PDFs | `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| 5 | **Render** (render.com) *or* Fly/Railway — for the server; **Vercel** (vercel.com) *or* Netlify — for the two web apps | Public HTTPS hosting (mandatory for PWA install + camera + mic) | the deployed URLs |

(Optional 6th: **LangSmith** (smith.langchain.com) → `LANGSMITH_API_KEY` to inspect/iterate the synthesis prompt. Skip for first pilot.)

---

## B. Step-by-step

### 1. Anthropic key (~3 min)
console.anthropic.com → **Settings → API Keys → Create Key** → copy → this is `ANTHROPIC_API_KEY`.
(Model defaults to `claude-opus-4-8`; set `ANTHROPIC_MODEL=claude-sonnet-4-6` to cut cost/latency.)

### 2. Deepgram key (~3 min)
console.deepgram.com → sign up → **API Keys → Create a New API Key** (role: Member) → copy → `DEEPGRAM_API_KEY`.

### 3. Neon Postgres (~4 min)
neon.tech → **New Project** → after it creates, **Connection string** → copy the **pooled** string
(looks like `postgres://user:pass@...neon.tech/neondb?sslmode=require`) → `DATABASE_URL`.

### 4. Cloudflare R2 (~6 min)
dash.cloudflare.com → **R2 → Create bucket** (e.g. `fieldreport-media`) → note the name → `S3_BUCKET`.
Then **R2 → Manage R2 API Tokens → Create API Token** (Object Read & Write) → copy:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. The token page shows your **S3 endpoint**
`https://<accountid>.r2.cloudflarestorage.com` → `S3_ENDPOINT`. Set `S3_REGION=auto`.
(AWS S3 instead: create a bucket + an IAM user with `s3:PutObject/GetObject` on it; leave `S3_ENDPOINT` unset; set `S3_REGION` to the bucket region.)

### 5. Pick an admin token
Any random string (e.g. run `openssl rand -hex 16`) → `ADMIN_TOKEN`. You'll use it to open `/admin`.

### 6. Deploy the **server** (Render, ~10 min)
- render.com → **New → Web Service** → connect this repo → **Runtime: Docker**, **Dockerfile path:** `apps/server/Dockerfile`, **Docker build context:** repo root (`.`).
- Add environment variables: `ANTHROPIC_API_KEY`, `DEEPGRAM_API_KEY`, `DATABASE_URL`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION=auto`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `ADMIN_TOKEN`, and the pilot project: `PILOT_PROJECT_NAME`, `PILOT_SUPER_NAME`.
- Deploy. Note the URL (e.g. `https://fieldreport-server.onrender.com`). **Then add one more env var** `PUBLIC_BASE_URL` = that exact URL and redeploy (it's used to build report links).
- Sanity check: open `https://<server>/healthz` → should show `{ ok: true, storage: "s3", stt: "deepgram", synthesis: "claude" }`.

### 7. Deploy the **capture** app (Vercel, ~5 min)
- vercel.com → **Add New → Project** → import repo → **Root Directory:** `apps/capture` → Framework: Vite.
- Env vars: `VITE_API_BASE` = your server URL, `VITE_PROJECT_ID=pilot-project`, `VITE_SUPER_NAME` = the super's name.
- Deploy → note the HTTPS URL. **This is the link the superintendent installs** (see `ONBOARDING.md`).

### 8. Deploy the **web** (review + admin) app (Vercel, ~4 min)
- Same as above but **Root Directory:** `apps/web`, env `VITE_API_BASE` = server URL → note the URL.
- Review links the super gets are `https://<web>/review/<reportId>`; operator console is `https://<web>/admin` (paste `ADMIN_TOKEN`).

---

## C. Paste-ready env block (for the server)

```
PUBLIC_BASE_URL=https://<your-server-url>
ANTHROPIC_API_KEY=
# ANTHROPIC_MODEL=claude-opus-4-8
DEEPGRAM_API_KEY=
DATABASE_URL=postgres://...sslmode=require
S3_BUCKET=fieldreport-media
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_REGION=auto
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
ADMIN_TOKEN=
PILOT_PROJECT_NAME=Watson Island
PILOT_SUPER_NAME=<super's name>
```

Confirm the **project glossary** before the walk: edit `apps/server/src/pilot.ts`
(`PILOT_GLOSSARY`) with the real tower/area/company/RFI proper nouns — that's where almost
all transcription accuracy comes from.

See `DEPLOY.md` for the full deploy walkthrough and `ONBOARDING.md` for the super's one-pager.

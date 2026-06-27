# FieldReport — Architecture

Offline-first field-report capture for construction superintendents. A super walks a
jobsite with no signal, captures `photo(s) + voice note` per observation, and on
regaining internet the bundle syncs, gets transcribed + synthesized into a polished
report (hosted HTML + PDF), is reviewed/edited by the super, then circulated.

This document + `PROGRESS.md` + `DECISIONS.md` are the durable source of truth. Any
agent (or a fresh context) re-orients from these three files, not by re-reading code.

---

## 1. Stack (off-the-shelf bias — spec §4)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | one language across the upload seam; shared types |
| Monorepo | npm workspaces | built into the installed npm 10.9; no extra tool |
| Contracts | `@fieldreport/contracts` (zod) | one frozen source of shapes + runtime validation |
| Capture client | Vite + React + `vite-plugin-pwa` (Workbox) | installable offline PWA |
| Local store | Dexie (IndexedDB) | durable on-device store for media until sync |
| Compress-on-capture | `browser-image-compression` | shrink ~40 photos before IndexedDB |
| Audio | native `MediaRecorder` | no lib; verify on-device (iOS quirk, §9) |
| Backend | Fastify + TS | typed, schema-first, fast; single service for MVP |
| DB | Postgres via Drizzle ORM | prod: node-postgres; dev/test: **pglite** (embedded, no server) |
| Object storage | S3-compatible via `@aws-sdk/client-s3` | prod: Cloudflare R2 / S3; dev: local-disk driver |
| Transcription | Deepgram Nova (keyterms) | domain-vocab biasing; mock provider for offline dev |
| Synthesis (IP) | Claude (Anthropic SDK) + LangSmith `traceable` | the differentiated call; mock provider for offline dev |
| Report render | server React → HTML → Playwright (Chromium) PDF | best image/page-break fidelity |
| Review + Admin | Vite + React (`@fieldreport/web`, online) | inline-edit gate + raw-vs-polished inspection |

Substitutions are logged in `DECISIONS.md` only.

---

## 2. Repo layout

```
fieldreport/
├─ package.json                 # npm workspaces root
├─ tsconfig.base.json
├─ ARCHITECTURE.md PROGRESS.md DECISIONS.md README.md
├─ packages/
│  └─ contracts/                # @fieldreport/contracts — FROZEN §5 shapes (zod)
│     └─ src/{schemas,lexicon,index}.ts
└─ apps/
   ├─ capture/                  # @fieldreport/capture — offline PWA (capture + sync ONLY)
   ├─ web/                      # @fieldreport/web — online: review-before-send + admin
   └─ server/                   # @fieldreport/server — ingest, storage, STT, synthesis,
                                #   render (HTML+PDF), hosted report, review + admin APIs
```

Three apps, one shared package. The capture PWA is deliberately minimal and robust
(its only job: capture + durable local storage + foreground sync). Everything online
(review, admin) lives in `web`. The hosted report page for PMs is server-rendered by
`server` (`GET /r/:id`) so it needs no build and works on any device.

---

## 3. Data contracts (frozen — spec §5)

Defined once in `packages/contracts/src/schemas.ts`. Zod schemas are authoritative;
TS types are inferred. Key shapes: `Observation`, `Report`, `Project`, plus the upload
seam (`UploadManifest`/`UploadObservation`/`UploadResult`), `ReportEdit` (review),
and `AdminReportView`. `CONTRACTS_VERSION` is stamped into every upload.

**Invariants every module must honor:**
- `Observation.order` is assigned at capture and preserved end-to-end.
- Annotations are a **separate layer**, never flattened onto the photo (§5, §9).
- `blobRef`/`audioRef` are server-assigned storage keys; the client carries bytes in
  IndexedDB keyed by client ids and uploads them as named multipart parts.
- `transcript` is filled by STT; `cleanedDescription`/`trade`/`area` by synthesis.
- Nothing is shareable until `Report.status === 'reviewed'` (review gate, §3).

---

## 4. Module boundaries & public interfaces

Each module is built against the frozen contracts and exposes a narrow surface so no
module needs another's internals in context.

### `@fieldreport/capture` (PWA)
- Routes: onboarding/install → capture loop → sync.
- IndexedDB (Dexie) schema: `walks`, `observations`, `photos(blob)`, `audio(blob)`.
- On capture: compress photo → write blob to IndexedDB **immediately**; record audio →
  write blob immediately. Never holds a session only in memory.
- Sync: foreground only (no iOS Background Sync, §9). Builds `UploadManifest` + multipart
  body, POSTs `POST /api/upload`, shows progress, retries, clears local on ack.

### `@fieldreport/server` (HTTP API + pipeline)
Public HTTP surface (all JSON unless noted):
- `POST /api/upload` (multipart: `manifest` JSON part + media parts) → `UploadResult`.
  Idempotent on `walkId`. Persists rows, stores media, **corrects EXIF orientation**,
  kicks off async processing.
- `GET  /api/reports/:id` → `Report` (with processing status).
- `GET  /api/reports/:id/status` → `{ processing, error? }` (poll during processing).
- `PATCH /api/reports/:id` (body `ReportEdit`) → `Report` (inline edits; draft only).
- `POST /api/reports/:id/finalize` → `Report` (status→`reviewed`; (re)render HTML+PDF).
- `GET  /r/:id`        → hosted HTML report (server-rendered; PM-facing).
- `GET  /r/:id.pdf`    → PDF download (Playwright-rendered).
- `GET  /api/admin/reports` + `GET /api/admin/reports/:id` → `AdminReportView`
  (raw photos + verbatim transcripts beside polished output; behind admin token).
- `GET  /media/:key`   → streams stored media (signed/scoped).
- `GET  /healthz`.

Internal pipeline (`uploaded → transcribing → synthesizing → rendering → ready`):
1. **ingest** — validate manifest, store media, EXIF-correct + resize, persist rows.
2. **transcribe** — per audio, Deepgram (keyterms = base lexicon + project glossary).
3. **synthesize** — one Claude call over ordered transcripts + project context →
   per-observation `cleanedDescription`, `trade`/`area`, and `summary`. LangSmith-traced.
4. **render** — React→HTML template; Playwright Chromium → PDF; store both.

### `@fieldreport/web` (online React)
- `/review/:id` — the trust gate. Shows draft, inline-edit prose, `PATCH` autosave,
  `finalize` → links to hosted HTML + PDF. Nothing shareable until passed.
- `/admin` — protected; lists reports; raw inputs vs polished output.

---

### 4b. Frozen inter-module factory signatures (server)

The server is split into leaf modules (delegated) + wiring (orchestrator-owned). All
modules code against these signatures so they compose without holding each other's
internals. Seams already on disk: `synthesis/{types,prompt}.ts`, `stt/types.ts`,
`storage/types.ts`, `db/schema.ts`, `config.ts`.

```ts
// storage/index.ts
export function makeStorage(cfg: AppConfig): StorageDriver;            // local | s3
// db/index.ts
export async function getDb(cfg: AppConfig): Promise<Db>;             // drizzle over pglite|pg
export function makeRepo(db: Db): Repo;                               // typed data access (below)
export async function ensureSchema(db: Db): Promise<void>;            // idempotent CREATE TABLE IF NOT EXISTS
// stt/index.ts
export function makeTranscriber(cfg: AppConfig): Transcriber;         // deepgram | mock
export function assembleKeyterms(glossary: string[]): string[];      // base lexicon ∪ glossary, deduped
// synthesis/index.ts
export function makeSynthesizer(cfg: AppConfig): Synthesizer;         // claude | mock (uses prompt.ts)
// render/index.ts
export function renderReportHtml(view: ReportRenderModel): string;   // React renderToStaticMarkup
export async function renderReportPdf(html: string): Promise<Uint8Array>; // Playwright chromium
```

`Repo` (db/index.ts) exposes at least: `getProject`, `upsertPilotProject`,
`createReportFromUpload(manifest, mediaKeys)` (idempotent on walkId), `getReport(id)`,
`getReportStatus(id)`, `applyEdit(id, ReportEdit)`, `finalize(id, {htmlKey,pdfKey})`,
`setProcessing(id, status, err?)`, `setTranscript(obsId, text, conf?)`,
`applySynthesis(reportId, SynthesisOutput)`, `getAdminView(id)`, `listReports()`,
`toReportContract(id): Report`. `ReportRenderModel` = the `Report` contract plus
resolved media URLs per photo.

The orchestrator owns the **wiring**: `app.ts` (Fastify + plugins), `routes/*`
(the §4 HTTP surface), `pipeline.ts` (uploaded→transcribing→synthesizing→rendering→ready),
`index.ts`, and `scripts/{dryrun,seed,db-init}.ts`.

## 5. The two context-injection points (spec §8 — do not conflate)

- **(a) Transcription-time** — makes STT *hear* words right. `base lexicon`
  (`contracts/lexicon.ts`, write-once) + `Project.glossary` (per-site proper nouns,
  where the real accuracy lives) → Deepgram keyterms / Whisper prompt.
- **(b) Synthesis-time** — makes the LLM *understand & present*. A separate system
  prompt on the report call (`server/src/synthesis/prompt.ts`) — the IP. Iterated under
  LangSmith against dry-run transcripts; cleanly swappable.

---

## 6. Deployment topology (deploy-ready; deployed by human at Checkpoint B)

- `capture` + `web` → static hosts (Vercel/Netlify). HTTPS mandatory (PWA/cam/mic).
- `server` → container host (Render/Fly/Railway) via `apps/server/Dockerfile`
  (bundles Chromium for Playwright).
- Postgres → Neon. Object storage → Cloudflare R2 (S3 API).
- All secrets via env (`.env.example` enumerates them). See `KEYS_CHECKLIST.md`.

---

## 7. Local-dev / verification story (no external accounts needed)

The whole pipeline runs locally with zero paid services so the build is verifiable
before Checkpoint B:
- DB → **pglite** (embedded Postgres, in-process). Storage → **local-disk** driver.
- STT → **mock** provider (deterministic transcripts). Synthesis → **mock** provider
  (deterministic, template-based) when `ANTHROPIC_API_KEY` is unset.
- Render → real Playwright Chromium (installed locally) → real PDF.
- `npm run dryrun` seeds a synthetic walk → ingest → transcribe → synthesize → render,
  and writes the HTML+PDF to `dryrun-output/` for inspection.

Providers are selected by env: real keys present → real providers; absent → mocks.

---

## 8. Gotchas handled explicitly (spec §9)

- **iOS storage eviction** → onboarding forces Add-to-Home-Screen (durable storage).
- **No iOS Background Sync** → foreground sync with progress + retry; never promise
  pocket upload.
- **EXIF orientation** → corrected server-side at ingest (and on compress client-side).
- **iOS MediaRecorder flakiness** → Phase 0 device spike verifies on the actual phone.
- **Compress on capture** → `browser-image-compression` before IndexedDB write.
- **HTTPS everywhere** → required for install/cam/mic; real URL needed to test at all.

---

## 9. Status & checkpoints

See `PROGRESS.md` for the live checklist and `DECISIONS.md` for choices/assumptions.
Human checkpoints (spec §11): **A** device-verify the spike, **B** accounts/keys +
deploy, **C** final review. In this build env (no device, no accounts) A and B are
batched into a single handoff after all phases are built deploy-ready + locally verified.

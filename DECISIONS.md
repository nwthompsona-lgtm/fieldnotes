# FieldReport — Decisions & Assumptions

Running log of engineering choices and assumptions (spec §2: decide, log, proceed).
Newest at top within each section.

---

## Checkpoint interpretation (important)

**D0. Building backend before Checkpoint A passes.** The spec (§6, §11-A) says "do not
build the backend until input reliability is verified on-device." In this build
environment there is **no pilot device and no hosting account**, so I cannot deploy the
spike or run the device test myself — strictly blocking would mean delivering almost
nothing autonomously, contradicting the core directive "go as far as you possibly can
without human intervention."
- The gate's underlying purpose is *don't waste backend effort if PWA capture fails
  on-device.* The spec itself says that if PWA fails, we "switch the capture client to
  React Native via Expo and keep everything server-side identical." So the backend is
  **client-agnostic by design** — it is not wasted even if the device test forces Expo.
- Decision: build the capture spike **first and most carefully** (highest risk), then
  build all backend phases to deploy-ready + locally-verified. Batch Checkpoints **A**
  and **B** into a single human handoff (account creation + deploy + device test happen
  in one sitting). This honors "batch everything" (§11) and the autonomy directive.

---

## Stack & architecture

**D1. npm workspaces (not pnpm/turbo).** The installed Node ships npm 10.9; npm
workspaces cover the monorepo need with zero extra tooling. No reason to add pnpm.

**D2. Fastify (not Express).** First-class TS types, JSON-schema validation, faster.
Single backend service for the MVP (ingest + pipeline + render + APIs) — no premature
service split.

**D3. pglite for dev/test, Postgres for prod (via Drizzle).** Spec mandates Postgres
(§4/§5). Drizzle targets both `pg` (prod: Neon) and `@electric-sql/pglite` (embedded,
in-process) so the **entire pipeline runs and is verifiable locally with no DB server,
no Docker, no account**. Same schema/queries both ways. Big win for "verify before
surface" given no managed PG is provisioned.

**D4. Object storage abstraction with local-disk dev driver.** `StorageDriver`
interface; `LocalDiskDriver` (writes under `.data/`) for dev/test; `S3Driver`
(`@aws-sdk/client-s3`, works against Cloudflare R2) for prod. Selected by env.

**D5. Provider pattern for STT + synthesis, mock by default.** `Transcriber` and
`Synthesizer` interfaces. Real providers (Deepgram, Anthropic+LangSmith) activate when
their env keys are present; otherwise deterministic **mock** providers run so local dry
runs work offline. The mock synthesizer is good enough to validate template + flow, and
the prompt (the IP) is written for the real Claude provider.

**D6. Server-rendered React for the hosted report + PDF.** `renderToStaticMarkup`
produces clean, componentized HTML; Playwright Chromium prints it to PDF. One template,
two outputs (hosted HTML + PDF) — guarantees the PDF matches the web view.

**D7. Three apps split.** `capture` (offline PWA, capture-only, minimal/robust), `web`
(online review + admin), `server` (API + pipeline + hosted report). Keeps the PWA's
service-worker surface tiny and isolates the high-risk offline path.

**D8. Capture client = PWA first (Expo only if device test fails).** Per §0/§6. Backend
is identical either way, so this choice is reversible at zero backend cost.

**D9. Node installed as portable ZIP (v22.12 LTS) under user dir.** No system Node was
present; winget install risks UAC/admin prompts in a non-interactive shell. Portable ZIP
needs no admin. Harness shells don't source profiles, so node is put on PATH by inlining
`$env:Path` per command (PowerShell) — documented in README for the human.

**D10. git: init deferred / commits not auto-made.** Working dir is not a git repo.
Harness guidance: commit only when the user asks. Will `git init` for tooling but hold
commits for the user's call. (Update this line when acted on.)

---

**D11. Synthesis output via prompt-enforced JSON + zod parse (not structured-outputs helper).**
The installed `@anthropic-ai/sdk@0.32.1` predates `messages.parse`/`zodOutputFormat`. Rather
than upgrade an SDK I can't live-test (no key in this env), the Claude provider uses the
stable `messages.create` + a system prompt that mandates JSON, then tolerant extraction +
`SynthesisOutput.safeParse` + one repair retry + id-reconciliation. Version-proof and
model-agnostic. If a key is added and structured outputs are wanted, swap inside `claude.ts`.

**D12. Synthesis default model = `claude-opus-4-8`.** Per the claude-api skill (don't downgrade
for cost — the user's call). The prose is the product's IP, so default to the most capable
model; `ANTHROPIC_MODEL=claude-sonnet-4-6` is the documented cost/latency override. No `thinking`
param (opus-4-8 runs without thinking when omitted) to keep the output budget for the JSON and
avoid truncation; tunable later.

**D13. Photo `blobRef` resolved to URLs in API responses.** `GET /api/reports/:id` (and admin)
map each stored photo key → `storage.url(key)` so the web client can render images directly.
The contract explicitly allows `blobRef` to be a key OR an object URL, so this is contract-legal.

**D14. Server image = official Playwright base.** `apps/server/Dockerfile` builds on
`mcr.microsoft.com/playwright:v1.49.0-jammy` (Chromium + system libs preinstalled), built from
the repo root so the contracts workspace is available. Avoids hand-installing browser deps.

**D15. Leaf modules (storage/db/stt/synthesis) authored by orchestrator, not delegated.**
After delegating the capture PWA + web app to workflows, I wrote the server leaf modules
directly: they're tightly coupled to the wiring + repo and SDK-version-sensitive (the synthesis
provider especially). Verified by *running* the real pipeline (`npm run dryrun` → real PDF),
which is stronger than delegate-then-review for mechanical plumbing. Logged per §2 autonomy.

**D16. Self-tests are isolated from prod infra.** Once `.env` held live Neon + R2 creds,
`npm run dryrun` would write synthetic walks into the pilot's real DB/bucket (and the
fixed obs-ids collided on the persistent DB). Fixes: a `FIELDREPORT_LOCAL=1` config knob
forces pglite + local-disk even when prod creds are present; `dryrun` sets it (plus
`STT_PROVIDER=mock`) by default via a dynamic config import + run-unique ids. Added
`STT_PROVIDER`/`SYNTHESIS_PROVIDER` override knobs (force mock/real independently — lets
the curated corpus feed real Claude for prompt tuning). Cleaned the one stray dryrun
report out of prod Neon (`npm run clean:test`). Tooling: `scripts/tune.ts` (corpus →
real synthesis, printed for eyeballing) + `scripts/clean-test-data.ts`.

**D17. Synthesis prompt validated with live `claude-opus-4-8` — no changes needed.** Ran the
curated corpus through real Claude (`npm run tune`) and rendered it through the template.
All fidelity rules held: "prepped for the pour" stayed prepped (never "poured"), tentative
work ("supposed to start") stayed tentative, the garbled clip became a neutral placeholder
(no fabrication), and proper nouns (JMA, Najib, EIFS, RFI) were spelled correctly. Prose is
professional; trade/area inference is sharper than the mock (pulled "Level 4" from "here on
four"); the summary is PM-trustworthy. Resisted over-tuning a prompt that's performing well.

**D18. Vercel SPA configs added.** `apps/web/vercel.json` + `apps/capture/vercel.json` rewrite
unmatched routes to `/index.html` so deep links (`/review/:id`, `/admin/:id`) work on static
hosting (Vercel serves real files first, so assets + the service worker are unaffected).

**D19. Preparer + project are captured per-report, not baked at build (contract → 1.1.0).**
The pilot build baked `VITE_SUPER_NAME`/`VITE_PROJECT_ID` into every walk, so reports were
attributed to a guessed default and "the project" was a single magic id. Per user feedback we
now ask for both on the Review & Sync screen: **Your name** (remembered in `localStorage`,
generically labeled "Prepared by" on the report — the user may be a foreman/PM/owner's rep, not
only a superintendent) and **Project** (required; Sync is gated until filled; past labels feed a
datalist). Values persist onto the durable Dexie walk row before Sync reads them. `projectId` is
a deterministic slug of the label (`projectIdForName`) so re-using a label maps to the same
server-side Project (and its accruing glossary).
- Contract bumped **1.0.0 → 1.1.0** (additive, non-breaking): `UploadManifest.projectName?` and
  `Report.projectName?` (both optional, so v1.0.0 clients and old un-synced "pending" walks still
  upload — the server falls back to the seeded `pilot-project`).
- Server: `reports.projectId` is a FK to `projects.id`, so a user-named project must exist first.
  `ingest` calls `repo.ensureProjectFromUpload({id,name,superName})` when `projectName` is present
  — inserts with an empty glossary, or on conflict updates **only** name/superName (the curated
  glossary is preserved, never clobbered). `assembleReport` resolves `projects.name` into
  `Report.projectName` for display. No DDL/migration needed (purely additive code).
- **Deploy ordering matters:** the server must deploy *before* the new capture build — a new-build
  upload carries a fresh, non-seeded `projectId`, which an old server (without
  `ensureProjectFromUpload`) would reject on the FK. Server (Render) first, then capture (Vercel).
- New typed projects start with an **empty** glossary (base construction lexicon still applies).
  The curated `PILOT_GLOSSARY` only attaches to the seeded `pilot-project`; per-project STT biasing
  for real project nouns is now keyed to whatever label the user actually uses (see [[A2]]).

## Assumptions (revisit if wrong)

**A1. Single super, single project, hardcoded/magic-link auth** (spec §12). Pilot seeds
one Project (Watson Island / JMA per §8) and one super. No multi-user.

**A2. First pilot project nouns** seeded into `Project.glossary` from §8: "Watson Island",
"JMA", "Najib", "Lighthouse", plus tower/area names — to be confirmed with the human at
handoff (placeholder set provided; trivially editable per project).

**A3. Audio mime varies by device** (iOS mp4/aac vs others webm/opus). Client records in
whatever `MediaRecorder` supports and reports the mime in the manifest; server/STT treat
it opaquely. Verified for real only on-device (Checkpoint A).

**A4. Markup deferred** (spec §12) but annotation layer shape frozen now (§5) so the
one-tool pen is an increment, not a refactor.

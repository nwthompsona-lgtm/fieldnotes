# FieldReport — Progress

Living checklist. Update after every milestone. A fresh context recovers exact state
from here + `ARCHITECTURE.md` + `DECISIONS.md`.

Legend: ✅ done & verified · 🟡 in progress · ⬜ not started · ⏸️ blocked on checkpoint

_Last updated: 2026-06-27 — ALL phases built + locally verified. Server LIVE on Render
(https://fieldnotes-yglr.onrender.com) and the FULL CLOUD PATH IS PROVEN end-to-end with
real audio: real speech → Deepgram → Claude → R2 + Neon → hosted PDF (npm run e2e:live).
Three prod-only bugs found + fixed along the way (see below). Remaining: Vercel front-end
deploys (in progress) + on-device test (Checkpoint A)._

## Post-pilot-feedback UX (2026-06-27, after first real test)
- **Capture → report handoff** made obvious: after Sync the capture app shows a "Review &
  send report →" link and keeps a persistent "Submitted reports" list (was: no path from
  "uploaded" to the review page). (commit 10ddfaa)
- **Preparer + project captured per-report, not baked** (user feedback). The Review & Sync
  screen now asks for "Your name" (remembered) + a required "Project" (datalist of past
  labels); Sync is gated until both are filled. Report label is the generic "Prepared by".
  Contracts bumped **1.0.0 → 1.1.0** (additive `projectName?`); server creates the Project
  from the upload (FK-safe, glossary preserved). See DECISIONS **D19**. Verified: 4/4 builds,
  15/15 server tests, HTTP smoke (fresh project created + "Prepared by" rendered), and the
  capture form gating/persistence in-browser. Adversarial diff-review run pre-deploy; the one
  real bug it found (unicode project labels colliding to one id) was fixed.
  **Deploy order: server (Render) first, then capture (Vercel)** — see DEPLOY.md.

## Prod bugs found + fixed via the real-audio e2e (none visible until a real walk)
- **Render PDF render** — `playwright` npm had drifted to 1.61.1 vs the Docker image's
  v1.49.0-jammy → Chromium failed to launch. Pinned both to 1.61.1. (commit 5c325c3)
- **Anthropic 'Premature close'** — every synthesis call from Render dropped its connection
  (Deepgram/R2/Neon fine; worked locally on Node 22, failed on the image's **Node 24**).
  Streaming + retries didn't clear it; the root cause was the **15-month-old
  @anthropic-ai/sdk 0.32.1** vs Node 24/undici 7. Upgraded SDK → **0.106.0**; fixed. Also
  switched synthesis to streaming. (commits 33861a5, 65ee76e)
- **/healthz** now reports `commit` + `node` for deploy/version confirmation.

---

## Phase −1 · Environment & foundation (orchestrator-owned)
- ✅ Toolchain: portable Node 22.12 installed (no system Node); inline-PATH per call.
- ✅ Frozen contracts `@fieldreport/contracts` (schemas + base lexicon).
- ✅ Monorepo scaffold (npm workspaces, tsconfig.base).
- ✅ Governance docs: ARCHITECTURE / PROGRESS / DECISIONS.
- ✅ `npm install` at root + contracts build + **4/4 contract tests pass**.
- ✅ git init + .gitignore (staged, not committed — see D10).

## Phase 0 · Device de-risk spike (built; device test still owed) ✅(build)
Built by a workflow (builder → adversarial review → fix). `tsc` clean, Vite build emits
service worker + manifest, app mounts with no console errors.
- ✅ `@fieldreport/capture` (Vite + React + vite-plugin-pwa).
- ✅ Onboarding forces Add-to-Home-Screen (standalone detection; dev escape hatch).
- ✅ Capture loop: photo(s) + voice note per observation; compress-on-capture.
- ✅ IndexedDB (Dexie) durable write before anything else (one row per blob).
- ✅ Running list w/ retake/delete; ✅ foreground sync w/ progress + retry; idempotent walkId.
- ✅ Contract conformance verified (manifest, audioField, photo field-names).
- ⏸️ **Checkpoint A**: human must test offline capture + audio + sync on the pilot iPhone.

## Phase 1 · Backend ingestion + storage ✅ (verified via dry-run)
- ✅ Fastify app + config + `/healthz`.
- ✅ pglite (dev) / Postgres (prod) via Drizzle; idempotent schema bootstrap; typed repo.
- ✅ Object storage abstraction (local-disk dev / S3-R2 prod).
- ✅ `POST /api/upload` (multipart, idempotent on walkId) → persist + store media.
- ✅ EXIF orientation correction + resize/compress (sharp) — verified (1200×900, ~15KB).

## Phase 2 · Transcription + synthesis ✅ (mock verified; real gated on keys)
- ✅ STT interface + Deepgram provider (keyterms) + mock provider.
- ✅ Vocabulary biasing (base lexicon ∪ project glossary; assembleKeyterms).
- ✅ Synthesis interface + Claude provider (parse+repair, opus-4-8) + mock.
- ✅ Synthesis system prompt (the IP) — `synthesis/prompt.ts` (fidelity rules).
- ✅ LangSmith `traceable` wiring (no-op without key).

## Phase 3 · Report render ✅ (real PDF verified)
- ✅ React HTML report template (header, draft banner, summary, grouped observations, footer).
- ✅ Playwright Chromium HTML→PDF (self-contained data-URL images).
- ✅ Hosted HTML view `GET /r/:id` (+ processing page) + PDF `GET /r/:id.pdf`.

## Phase 4 · Review-before-send (hard requirement) ✅ (screenshot-verified)
- ✅ API: `GET /api/reports/:id`, `/status`, `PATCH` (edit→draft), `POST /finalize` (→reviewed, re-render).
- ✅ `/review/:id` inline-edit UI + debounced autosave (coalesced, never drops edits) — `apps/web`.
- ✅ Gate verified: shareable links hidden until finalized; edit reverts to draft (HTTP smoke + screenshot).

## Phase 5 · Admin/operator view ✅ (screenshot-verified)
- ✅ API: `GET /api/admin/reports[/:id]` (token-gated) → raw photos + verbatim transcripts vs polished.
- ✅ `/admin` + `/admin/:id` UI (`apps/web`); token gate enforced (401 without, 200 with).

## Phase 6 · Polish + self-test + deploy-ready
- ✅ End-to-end local dry run (`npm run dryrun`) passes; HTML+PDF inspected (template screenshot reviewed).
- ✅ Deploy scripts + `apps/server/Dockerfile` (Playwright base) + `.dockerignore` + `KEYS_CHECKLIST.md` + `DEPLOY.md`.
- ✅ Onboarding one-pager + post-walk feedback form (`ONBOARDING.md`).
- ✅ Tests: contracts 4/4, server 15/15 (EXIF, synthesis fidelity, idempotency, repo, review gate, storage).
- ✅ HTTP smoke test (`apps/server/scripts/smoke.mjs`) — upload→pipeline→edit→finalize→hosted HTML+PDF→admin.
- ✅ Full monorepo production build green (contracts/server/capture/web).
- ⬜ 2–3 self-driven dry runs to tune the synthesis prompt (needs ANTHROPIC_API_KEY — batched into Checkpoint B).
- ⏸️ Acceptance checklist (§10) end-to-end on a live URL + real iPhone (needs deploy + device — Checkpoints A/B/C).

## Checkpoints (spec §11)
- ⏸️ **A** — device verify spike (needs pilot iPhone; do at/after Vercel capture deploy).
- 🟡 **B** — accounts/keys + deploy:
  - ✅ All 4 provider keys live + verified (`npm run verify:keys`): Anthropic opus-4-8, Deepgram nova-2, Neon, R2.
  - ✅ **Server LIVE** on Render (Docker, Standard 2 GB): https://fieldnotes-yglr.onrender.com.
  - ✅ **Full cloud path proven end-to-end with real audio** (`npm run e2e:live`): real speech →
    Deepgram → Claude → R2 + Neon → hosted HTML + PDF (HTTP 200). Fidelity held even through an STT error.
  - ⬜ Vercel deploys for `apps/capture` + `apps/web` (`vercel.json` SPA configs in repo; in progress).
  - ✅ Synthesis prompt self-tested with real Claude (`npm run tune`); prod test data cleaned (`npm run clean:test`).
- ⏸️ **C** — final review (live URL + acceptance + onboarding).

### Self-test / ops scripts (apps/server/scripts)
`dryrun` (local, real prose), `tune` (corpus→real synthesis), `smoke.mjs` (HTTP e2e),
`verify-keys`, `clean:test` (purge synthetic walks), `shoot.mjs`/`web-shot.mjs` (visual QA).

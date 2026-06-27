# FieldReport (pilot MVP)

Offline-first field-report capture for construction superintendents. Capture
`photo(s) + voice note` per observation with no signal; on regaining internet the
bundle syncs, gets transcribed + synthesized into a polished report (hosted HTML +
PDF), is reviewed/edited by the super, then circulated.

> Read **`ARCHITECTURE.md`** for the design, **`PROGRESS.md`** for status, and
> **`DECISIONS.md`** for why things are the way they are.

## Monorepo

- `packages/contracts` — frozen shared shapes (`@fieldreport/contracts`).
- `apps/capture` — offline capture PWA (`@fieldreport/capture`).
- `apps/web` — online review + admin (`@fieldreport/web`).
- `apps/server` — API, storage, transcription, synthesis, render (`@fieldreport/server`).

## Prerequisites

- Node ≥ 20.11 (this machine uses a portable Node 22.12 under
  `C:\Users\NickThompson\tools\node-v22.12.0-win-x64`).
- **Windows / PowerShell note:** the shell here doesn't have Node permanently on PATH.
  Prefix Node commands with:
  ```powershell
  $env:Path = 'C:\Users\NickThompson\tools\node-v22.12.0-win-x64;' + $env:Path
  ```
  (Or install Node normally and skip this.)

## Quick start (local, no accounts needed)

```bash
npm install                 # installs all workspaces
npm run build:contracts     # build the shared types
npm run dev:server          # backend on :8787 (pglite + local-disk storage + mock STT/LLM)
npm run dev:capture         # capture PWA on :5173
npm run dev:web             # review + admin on :5174
npm run dryrun              # seed a synthetic walk end-to-end -> dryrun-output/ (HTML + PDF)
```

With no `ANTHROPIC_API_KEY` / `DEEPGRAM_API_KEY` set, the server uses deterministic
**mock** providers so the whole flow runs offline. Add real keys (see
`apps/server/.env.example`) to use Deepgram + Claude.

## Deploy

Deploy-ready but not deployed — needs accounts/keys. See **`KEYS_CHECKLIST.md`** (the one-sitting
account/key handoff), **`DEPLOY.md`** (mechanics + Dockerfile), and **`ONBOARDING.md`** (the
superintendent's one-pager + post-walk feedback form).

## Status

Pilot build in progress. See `PROGRESS.md`.

# @fieldreport/web — Review &amp; Admin

The online surface for the FieldReport pilot. Two audiences:

- **Superintendent — the trust gate** (`/review/:id`): watch a report process, edit
  the AI-drafted write-up inline (autosaves), then **finalize** to produce the
  shareable HTML + PDF. Nothing is shareable until review is finalized.
- **Operator — quality admin** (`/admin`, `/admin/:id`): token-gated raw-vs-polished
  inspection — original photos, audio, and the verbatim transcript beside the
  synthesized description, trade, and area.

Pure client SPA (Vite + React + TypeScript + react-router). It only talks to the
FieldReport server over the documented HTTP API; all wire shapes come from
`@fieldreport/contracts`.

## Routes

| Route          | Purpose                                                            |
| -------------- | ----------------------------------------------------------------- |
| `/`            | Index — explains both surfaces, jump to a report id for review.   |
| `/review/:id`  | Status polling, editable draft + autosave, finalize gate.         |
| `/admin`       | Token-gated table of all reports.                                 |
| `/admin/:id`   | Side-by-side raw inputs vs. polished output per observation.      |

## Develop

Node here is portable and not on `PATH`; prefix every command. From the repo root:

```sh
# PowerShell
$env:Path = 'C:\Users\NickThompson\tools\node-v22.12.0-win-x64;' + $env:Path

npm install
npm run dev -w @fieldreport/web        # http://localhost:5181
npm run build -w @fieldreport/web
npm run preview -w @fieldreport/web
npm run typecheck -w @fieldreport/web
```

## Configuration

Copy `.env.example` to `.env` and set:

- `VITE_API_BASE` — base URL of the FieldReport server (default `http://localhost:8787`).

## How autosave works

`useAutosave` debounces edits ~800ms and `PATCH`es only the changed fields as a
`ReportEdit`. Patches merge per-field (and per-observation by id) into a pending
buffer so several quick edits collapse into one request. The buffer is cleared
only after the request resolves; a failed save merges the edit back and shows
**Save failed — retry**, so edits are never lost. Editing reverts the report to
`draft` server-side, which the UI reflects.

## How the finalize gate works

The shareable links (`htmlUrl`, `pdfUrl`) are **hidden** while `status === 'draft'`.
"Finalize &amp; create shareable report" `POST`s `/finalize`; on success the report
flips to `reviewed`, a **Reviewed** badge appears, and the hosted HTML link + PDF
download are revealed. Further edits revert to draft and require re-finalizing.

## How admin auth works

The operator pastes the `ADMIN_TOKEN` into a gate; it's persisted in
`localStorage` and sent as `Authorization: Bearer <token>` on every admin request.
A `401` clears the stored token and re-prompts.

# @fieldreport/capture

The **CAPTURE** PWA — the offline-first phone client a construction superintendent
uses on a jobsite with **no internet**. It captures observations (photos + one
voice note each) durably on-device and uploads them to the server when the super
is back in coverage and taps **Sync**.

This is the highest-risk module in FieldReport: nothing a super captures on a walk
may ever be lost. The design treats **durability as sacred**.

## Stack

- Vite 5 + React 18 + TypeScript (extends the repo `tsconfig.base.json`)
- `vite-plugin-pwa` (Workbox, `generateSW`, `registerType: 'autoUpdate'`) — precaches
  the app shell for full offline boot; `/api/*` is `NetworkOnly` and never cached.
- `dexie` for IndexedDB durability
- `browser-image-compression` for compress-on-capture
- native `MediaRecorder` for voice notes
- `@fieldreport/contracts` (workspace) for the frozen upload contract

## Commands

```bash
# Node is portable and NOT on PATH — prefix every command:
#   export PATH="/c/Users/NickThompson/tools/node-v22.12.0-win-x64:$PATH"

npm install                              # from repo root (workspaces)
npm run dev      -w @fieldreport/capture # vite dev server (http://localhost:5180)
npm run build    -w @fieldreport/capture # tsc --noEmit && vite build (emits sw.js + manifest)
npm run preview  -w @fieldreport/capture # serve the production build
npm run typecheck -w @fieldreport/capture
npm run icons    -w @fieldreport/capture # regenerate PNG icons (zlib-only, no native deps)
```

## Config (env, spec §9)

Copy `.env.example` → `.env` and adjust. Baked at build time:

| var                | default                 | meaning                                    |
| ------------------ | ----------------------- | ------------------------------------------ |
| `VITE_API_BASE`    | `http://localhost:8787` | upload server base; POST `/api/upload`     |
| `VITE_PROJECT_ID`  | `pilot-project`         | stamped into the upload manifest           |
| `VITE_SUPER_NAME`  | `Pilot Super`           | stamped into the upload manifest           |

## The flow

1. **Onboarding gate (mandatory).** If the app is not running installed
   (`navigator.standalone` / `display-mode: standalone`), a blocking screen forces
   "Add to Home Screen" with explicit iOS-Safari and Android/Chrome steps. Durable
   iOS storage requires Home-Screen install. A "Continue anyway" escape hatch exists
   **only** under `import.meta.env.DEV`.
2. **Capture loop, one observation at a time** (spec §3):
   `New Observation` → take photo(s) → `Next: Voice Note` → record one voice note →
   `Save Observation` → repeat. One observation = one-or-more photos + exactly one
   voice note. (No continuous narration.)
3. **Running list** of this walk's observations in order, each with a thumbnail and
   a **Delete** action; per-photo remove is available before save. A header shows the
   live **count** and **approximate MB stored**.
4. **Done → Review & Sync.** Finishing the walk flips it to `pending`. The review
   screen shows the list + a **Sync** button.
5. **Sync** (foreground only — see below) builds the multipart body and POSTs it,
   with a visible progress bar and retry/backoff. On success, the acked observations
   are deleted from the device.

## Durability guarantees (spec §4)

- The **instant a photo is taken** it is compressed (jpeg, ~1600px max dim, ~0.7
  quality) and the compressed `Blob` is written to IndexedDB **before any UI
  transition**. Natural width/height of the compressed image are captured and stored.
- The **instant audio recording stops**, the `Blob` is written to IndexedDB before
  the UI advances. `MediaRecorder` is started with a 1s timeslice so an abrupt
  backgrounding still flushes captured audio.
- A capture session is **never** held only in React state. A backgrounded app, an
  incoming phone call, or a crash mid-walk loses nothing — on next open the active
  walk and all its media are still in IndexedDB.
- Media is stored **one row per blob** (small, atomic writes), so a partial write
  can never corrupt previously-captured observations.

### Dexie schema (db version 1)

```
walks:        id, status, createdAt
observations: id, walkId, order
photos:       id, obsId, walkId        (+ blob, width, height, byteSize, order)
audio:        obsId, walkId            (+ blob, mime)   // one voice note per obs
```

(Only indexed fields are listed; blobs ride along on the row.)

## How Sync builds the multipart body (spec §7, frozen contract)

`POST {VITE_API_BASE}/api/upload`, `multipart/form-data`:

- field **`manifest`** = `JSON.stringify(UploadManifest)` (validated with the zod
  schema from `@fieldreport/contracts`; stamps `CONTRACTS_VERSION`, `walkId`,
  `projectId`, `superName`, device-local `date`, and a `client` breadcrumb).
- each photo's compressed bytes under a field **named `photo.id`**, filename
  `${photo.id}.jpg`.
- each observation's audio bytes under field **`audioFieldFor(obs.id)`** =
  `audio:${obs.id}`, with `audioMime` reporting the actual recorded mime.

Upload uses `XMLHttpRequest` for real upload-progress events. The response is parsed
as `UploadResult`; only `acceptedObservationIds` are cleared locally. Retries reuse
the **same `walkId`** (idempotency key) so the server never double-creates. Failures
retry with exponential backoff (4 attempts) and a clear **Retry** button.

**Foreground only.** iOS has no Background Sync — the app never implies pocket/
background upload. Sync runs only while the app is open with progress visible. On
open, if a pending walk exists and `navigator.onLine`, the app surfaces the review
screen so the user can tap Sync.

## Audio mime handling (spec §6)

`MediaRecorder.isTypeSupported` is consulted in order, preferring
`audio/webm;codecs=opus`, then `audio/webm`, then `audio/mp4` (iOS), etc. The mic is
requested explicitly with clear error messages for denial / no-device / in-use. The
real recorded mime is stored and reported as `audioMime`.

## Annotations (deferred)

No markup UI is built. Photos are stored as **clean compressed originals** so a
separate annotation layer (the `Annotation` shape is already frozen in contracts)
can be added later without a refactor.

## Icons

`scripts/gen-icons.mjs` is a self-contained Node script (built-in `zlib` only, no
native deps) that rasterizes a deep-green (`#0F3D2E`) square with white **FR** and
emits `icon-192`, `icon-512`, `icon-512-maskable`, a 180×180 `apple-touch-icon`, and
a 32px favicon. The PNGs are committed under `public/`.

## Known device risks (verify on real hardware)

- iOS `MediaRecorder` mime/availability and the mic-permission UX vary by iOS
  version — must be smoke-tested on a real iPhone.
- iOS Home-Screen-install durability and the standalone detection both require a
  real device (DevTools desktop standalone differs).
- IndexedDB eviction under storage pressure — installed PWAs get the durable bucket,
  but quota behavior should be checked on a low-storage device.

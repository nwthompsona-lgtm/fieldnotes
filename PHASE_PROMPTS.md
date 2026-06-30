# Phase kickoff prompts — Auth + Multi-Tenancy + Distribution

Each phase is built in its own session; we compact between phases. To start a phase, **paste that phase's block below** as the first message of a fresh session. The block is intentionally short — all the detail lives in `AUTH_MULTITENANCY_PLAN.md`, which the agent re-reads each time (it persists on disk; the chat does not).

- Build order is strictly sequential: **0 → 12.** Don't start a phase until the prior one is ✅ in the build tracker (`AUTH_MULTITENANCY_PLAN.md` §14.4).
- Phases 9–12 (frontend) also require the Claude Design zip extracted to `.design-handoff/auth-ui/`.
- The companion design prompt (for Claude Design, not for a build session) is `DESIGN_BRIEF_AUTH.md`.

---

### Phase 0 — Dev / staging environment

```text
Read AUTH_MULTITENANCY_PLAN.md top to bottom — it's the durable spec; assume no prior chat context. Then execute Phase 0 (Dev/staging environment) from §14.5.

Do the repo side now: cut the `develop` branch from `master`; add `render.dev.yaml` (a second Render service `fieldreport-server-dev` deploying from `develop`); make the small CORS allowlist change in config.ts (§14.2); add `.env.dev.example` files; and write a `DEV_ENV.md` runbook that lists, step by step, the dashboard actions I must do myself (create the separate Neon `fieldreport-dev` DB, the separate R2 `fieldreport-media-dev` bucket, the Render dev service, and the two Vercel `*-dev` projects) with the exact env vars each needs.

Rules: work on `develop` only — never touch `master` or anything pointing at the prod Neon DB / prod R2 bucket. Don't merge to master. When done, update the build tracker (§14.4) and tell me exactly which dashboard steps + secrets you need from me to finish standing up the dev server.
```

### Phase 1 — Foundation (schema + contracts)

```text
Read AUTH_MULTITENANCY_PLAN.md top to bottom — durable spec, no prior chat context. Then execute Phase 1 (Foundation: schema + contracts) from §14.5.

Scope: add deps (@node-rs/argon2, resend); add newId(prefix) to ids.ts; add the auth/email/app config blocks; add all new tables + the two alters (§1) to schema.ts and idempotent DDL to migrate.ts; bump contracts to 1.2.0 (§2) and log it in DECISIONS.md.

Rules: work on `develop` only; build + test locally (pglite + mocks). Additive + idempotent only — no NOT NULL/FK on existing columns, no route/behavior change. Follow the phase's Don't break / Verify exactly. When done: run `npm run build:contracts`, server typecheck, the existing test suite, and `npm run dryrun`; update the build tracker (§14.4) to ✅; commit to `develop`; report what changed and what Phase 2 now assumes.
```

### Phase 2 — Repo methods

```text
Read AUTH_MULTITENANCY_PLAN.md top to bottom — durable spec, no prior chat context. Then execute Phase 2 (Repo methods) from §14.5.

Scope: extend the Repo interface (db/types.ts) and makeRepo (db/repo.ts) with every method in §3, reusing the existing Drizzle patterns + db.transaction for multi-row writes.

Rules: work on `develop` only; pure additions (don't change existing repo methods). When done: typecheck; add apps/server/test/repo-auth.test.ts covering CRUD for each new entity against pglite (per the phase's Verify); update the build tracker (§14.4) to ✅; commit to `develop`; report what changed and what Phase 3 now assumes.
```

### Phase 3 — Auth core

```text
Read AUTH_MULTITENANCY_PLAN.md top to bottom — durable spec, no prior chat context. Then execute Phase 3 (Auth core) from §14.5.

Scope: auth/passwords.ts (argon2id), auth/sessions.ts (issue/resolve/revoke; indefinite when SESSION_TTL_DAYS=0), auth/context.ts (req.auth decorator + requireAuth guard, registered in app.ts), the /api/auth/{signup,login,logout,me} routes (§4.2), and the CORS allowlist swap (§11).

Rules: work on `develop` only; build + test locally. DO NOT add route guards yet — that's Phase 4; existing routes must still work, and the CORS allowlist must include local + dev origins (or stay permissive when unset). Follow the phase's Verify (signup dup→409, login bad→401, me, logout→401). When done: update the build tracker (§14.4) to ✅; commit to `develop`; report what changed and what Phase 4 now assumes.
```

### Phase 4 — Authz + route scoping + pilot seed  (MILESTONE — prod-promotable)

```text
Read AUTH_MULTITENANCY_PLAN.md top to bottom — durable spec, no prior chat context. Then execute Phase 4 (Authz + route scoping + pilot seed) from §14.5.

Scope: auth/authz.ts helpers (§5.2); guard EVERY existing route per §6 (upload, new GET /api/reports?projectId, report read/edit/finalize, split /r/:id to authed-internal, gate /media, re-gate /api/admin to org-admin); and the idempotent pilot seed/backfill in deps.ts (§12) so the live data keeps working once gated.

Rules: work on `develop` only. The seed MUST run before/with gating so the pilot admin can log in. Removing public /r/:id is INTENTIONAL — external access returns in Phase 8 via /s/:token; do not reopen /r. Keep everything idempotent. Verify: full authz-matrix test + seed/backfill test (§13), local smoke as the pilot admin, THEN deploy to dev/staging and re-smoke against the dev URL. When done: update the build tracker (§14.4) to ✅; commit to `develop`; report results. This is a prod-promotable milestone — DO NOT promote to master/prod; just tell me it's ready and list the prod env vars I must set first.
```

### Phase 5 — Email driver seam

```text
Read AUTH_MULTITENANCY_PLAN.md top to bottom — durable spec, no prior chat context. Then execute Phase 5 (Email driver seam) from §14.5.

Scope: apps/server/src/email/{types,resend,mock,templates,index}.ts; makeEmail(config) (resend when RESEND_API_KEY else mock that writes .eml/JSON + logs); wire email into ServerDeps; shareEmail + inviteEmail templates (§9), on-brand.

Rules: work on `develop` only; mock is the default (no key needed locally). Verify: unit test that the mock send captures the message and templates render. When done: update the build tracker (§14.4) to ✅; commit to `develop`; report what changed and what Phase 6 now assumes.
```

### Phase 6 — Invitations

```text
Read AUTH_MULTITENANCY_PLAN.md top to bottom — durable spec, no prior chat context. Then execute Phase 6 (Invitations) from §14.5.

Scope: POST /api/orgs/:orgId/invitations (org admin → token + inviteUrl, sends invite email), GET /api/auth/invitations/:token (preview), POST /api/auth/invitations/accept (create/update user, add membership + project_members, mark accepted, issue session) — per §4.2.

Rules: work on `develop` only; build + test locally. Accept must be safe against an already-existing user. Verify: tests for invite→accept, expired/invalid token, correct role assignment, mock invite email captured. When done: update the build tracker (§14.4) to ✅; commit to `develop`; report what changed and what Phase 7 now assumes.
```

### Phase 7 — Stakeholder directory + roster + defaults

```text
Read AUTH_MULTITENANCY_PLAN.md top to bottom — durable spec, no prior chat context. Then execute Phase 7 (Stakeholder directory + roster + defaults) from §14.5.

Scope: org-level stakeholder org/contact CRUD (org admin); per-project roster get/set (project_stakeholders); distribution-default get/set (project_distribution_defaults) — per §7.

Rules: work on `develop` only; build + test locally. Deleting a stakeholder/contact must not orphan past recipients (denormalized email/name; nullable contact_id) — per §1.2. Verify: directory CRUD + roster + default persistence tests. When done: update the build tracker (§14.4) to ✅; commit to `develop`; report what changed and what Phase 8 now assumes.
```

### Phase 8 — Send + delivery + external links  (MILESTONE — prod-promotable)

```text
Read AUTH_MULTITENANCY_PLAN.md top to bottom — durable spec, no prior chat context. Then execute Phase 8 (Send + delivery + external links) from §14.5.

Scope: POST /api/reports/:id/send (resolve SendSelection→recipients, finalize-if-needed, mint per-person tokens, persist distribution default, send emails best-effort); GET /api/reports/:id/sends (delivery audit); recipients revoke/resend; external GET /s/:token + /s/:token.pdf (validate, render, record first-open once, expired/revoked pages); list-row send summary — per §8.

Rules: work on `develop` only. /s/:token is intentionally unauthenticated (capability URL); confirm the hosted HTML embeds photos as data-URLs so external viewers need no /media access. Verify: tests (send→tokens+mock emails+default; /s valid→open once; revoked/expired→410; resend), THEN deploy to dev and send a real test report to my inbox via a Resend test key and confirm the open shows in the audit. When done: update the build tracker (§14.4) to ✅; commit to `develop`; report results. Prod-promotable milestone — DO NOT promote; tell me it's ready and what prod email env (RESEND_API_KEY, verified EMAIL_FROM domain) I must set first.
```

### Phase 9 (F1) — Web: auth + shell + reports list  (needs design zip)

```text
Read AUTH_MULTITENANCY_PLAN.md and DESIGN_BRIEF_AUTH.md, plus the design README in .design-handoff/auth-ui/. Then execute Phase 9 / F1 from §14.5.

Scope: in apps/web, build the auth screens (signup/login/accept-invite), the app shell (org + project switchers, user menu), and the reports list — implementing the design handoff using the existing styles.css tokens and wiring to the Phase 3–4 endpoints.

Rules: work on `develop` only; match the existing design system exactly (don't invent styling). Verify with the preview workflow, then deploy to dev. When done: update the build tracker (§14.4) to ✅; commit to `develop`; report what changed. (Prereq: Phases 3–4 done; design zip present.)
```

### Phase 10 (F2) — Web: send + delivery + settings  (needs design zip)

```text
Read AUTH_MULTITENANCY_PLAN.md and DESIGN_BRIEF_AUTH.md, plus the design README in .design-handoff/auth-ui/. Then execute Phase 10 / F2 from §14.5.

Scope: in apps/web, build the Send/distribution modal, the Delivery panel, and Settings (members & roles, project visibility, stakeholder directory) — per the design handoff, wired to the Phase 6–8 endpoints.

Rules: work on `develop` only; match the existing design system exactly. Verify with the preview workflow, then deploy to dev. When done: update the build tracker (§14.4) to ✅; commit to `develop`; report what changed. (Prereq: Phases 6–8 done; design zip present.)
```

### Phase 11 (F3) — Capture: login + project picker  (needs design zip)

```text
Read AUTH_MULTITENANCY_PLAN.md and DESIGN_BRIEF_AUTH.md, plus the design README in .design-handoff/auth-ui/. Then execute Phase 11 / F3 from §14.5.

Scope: in apps/capture, add the login screen and the project picker, and switch the upload to authenticated (preparer + project now come from the account + picker, not free-text on Review) — per the design handoff, wired to Phase 3–4 endpoints.

Rules: work on `develop` only; match the capture app's existing design system (mobile, safe-area, large touch targets). Verify on a mobile viewport, then deploy to dev. When done: update the build tracker (§14.4) to ✅; commit to `develop`; report what changed. (Prereq: Phases 3–4 done; design zip present.)
```

### Phase 12 (F4) — External recipient view + emails  (needs design zip)

```text
Read AUTH_MULTITENANCY_PLAN.md and DESIGN_BRIEF_AUTH.md, plus the design README in .design-handoff/auth-ui/. Then execute Phase 12 / F4 from §14.5.

Scope: the external recipient view shell around the hosted report (Download PDF, "shared with you / read-only / expires", plus link-expired and link-revoked states) and the styled distribution + invite emails — per the design handoff and §6/§8.

Rules: work on `develop` only; match the design system; the report body itself is already built (don't redesign it). Verify the expired/revoked/normal states + email rendering, then deploy to dev. When done: update the build tracker (§14.4) to ✅; commit to `develop`; report what changed. (Prereq: Phase 8 done; design zip present.)
```

# Auth + Multi-Tenancy + Distribution — Implementation Plan

Status: **planning** · Owner: backend (server) now; frontend after the Claude Design handoff.
Companion doc: `DESIGN_BRIEF_AUTH.md` (the prompt for Claude Design).
Convention: this is a root-level planning doc in the style of `ARCHITECTURE.md` / `DECISIONS.md`. § references point inside this file unless prefixed (e.g. `ARCHITECTURE §4`).

---

## 0. Overview

Today FieldReport is a **single hard-coded pilot project with one super and no real auth**: `/api/reports/:id`, `PATCH`, `finalize`, and the hosted `/r/:id(.pdf)` are all open; only `/api/admin/*` sits behind one static bearer token (`config.admin.token`). The pilot project + super are seeded at boot (`deps.ts`).

This plan turns that into a real multi-tenant product:

- **Identity**: email+password accounts (SSO later), long-lived revocable sessions.
- **Tenancy**: a generic `org` that can represent a GC, a solo super, or an owner. One user can belong to **many** orgs and switch between them.
- **Roles**: org-level `admin`; per-project `pm` / `super` / `viewer`. Per-project visibility setting (`org` vs `assigned`).
- **Distribution**: an org-level **stakeholder directory** (outside companies + their contacts), selectable per-project as one-tap groups; the system emails each recipient a **per-person, expiring, revocable link** to the hosted report (view in browser + Download PDF — **no attachment**); a **Delivery** audit records sent + first-opened per recipient.

### 0.1 Non-goals (this phase)

- SSO (Google/Apple/Microsoft) — design the identity layer so providers slot in later; don't build them now.
- Custom sending domains per org — Resend from one verified FieldReport domain now.
- The agentic "ask about this report" layer — out of scope, but the hosted report page is its future entry point.
- Billing/subscriptions.
- Audit beyond send/open (no field-level edit history yet).

### 0.2 Product decisions locked (from the discovery session)

| # | Decision |
|---|---|
| D-1 | `org` is generic (GC / solo / owner); a user can belong to many orgs and switch. |
| D-2 | Email+password now; SSO later as added providers on the same `user`. Sessions long-lived + revocable ("stay logged in indefinitely"). |
| D-3 | Roles: org-level `admin`; per-project `pm` / `super` / `viewer`. |
| D-4 | Project visibility is a **per-project** setting: `org` (any org member can view finalized) vs `assigned` (only project members). Org admins always see all. |
| D-5 | Onboarding: self-serve signup creates the org + makes the creator admin; admin invites others and assigns them to projects. |
| D-6 | Creator self-finalizes; **a PM (or admin) can edit & finalize ANY report on the project**. |
| D-7 | **Anyone who can finalize can send** (super / pm / admin). |
| D-8 | Distribution = stakeholder **orgs** (owner/architect/engineer/…) each with contacts; pick whole orgs or specific people; "+ add person/org" inline; **remember the last selection per project** as the default. |
| D-9 | Delivery = **system-sent email** (From: "Jake Romero via FieldReport", reply-to the super), body is a **per-person link** (no attachment); hosted page = view + Download PDF; links **time-boxed (30d default) + revocable**; **audit records sent + first-open per recipient**. |

### 0.3 Key technical decisions (recommended; see §15 to confirm)

| # | Decision | Why |
|---|---|---|
| T-1 | **Session = opaque bearer token in `localStorage`**, sent as `Authorization: Bearer <token>`; server-side `sessions` table (revoke = delete row). | The SPAs (Vercel) and API (Render) are cross-origin / cross-site. `SameSite=None` third-party cookies are increasingly blocked (Safari ITP, Chrome). A bearer token mirrors the existing admin-token pattern, needs no cookie plugin, and is robust cross-site. Trade-off: XSS-exposed — acceptable at "low stakes," revisit with cookies once we have same-site custom domains (`api.` + `app.`). |
| T-2 | **Password hashing = `@node-rs/argon2`** (argon2id). | Prebuilt binaries (no node-gyp) → builds cleanly in the Render Docker image. Modern, memory-hard. |
| T-3 | **Email via a pluggable `EmailDriver`**: `resend` provider in prod, `mock` (writes `.eml`/JSON to disk + logs) when no key — mirroring the existing STT/synthesis mock pattern so the whole flow runs offline. | Consistency with `makeStorage` / `makeTranscriber` / `makeSynthesizer`; offline dev with no account. Resend chosen for API-based send (no SMTP), domain verification, good DX. Postmark is the fallback if deliverability needs it. |
| T-4 | **Schema via the existing idempotent DDL** in `migrate.ts` (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`). No drizzle-kit. | Matches the current `ensureSchema` workflow; safe to re-run at every boot. |
| T-5 | **Share token = opaque random capability URL** (`/s/:token`), one row per recipient (`report_send_recipients`), stored with a unique index. | Per-person token enables open-tracking + per-recipient revoke. Capability URL = account-less by design. |
| T-6 | **IDs**: keep deterministic `r-<sha256>` for reports (idempotency); add `newId(prefix)` (`crypto.randomUUID`-based) for all new random-id entities (`org_`, `usr_`, `ses_`, `mem_`, `pm_`, `sko_`, `skc_`, `snd_`, `rcp_`, `inv_`). | Reuse `ids.ts`; don't add a nanoid dep. |

---

## 1. Data model

### 1.1 Entity overview

```
orgs ──< memberships >── users
  │                        │
  ├──< projects ──< project_members >── users
  │        │
  │        ├──< reports ──< observations ──< photos        (existing)
  │        │      │
  │        │      └──< report_sends ──< report_send_recipients
  │        │                                   │
  │        └──< project_stakeholders >── stakeholder_orgs ──< stakeholder_contacts
  │        └── project_distribution_defaults (1:1)
  │
  └──< stakeholder_orgs (directory lives at org level, referenced per project)

users ──< sessions
orgs  ──< invitations
```

### 1.2 New tables (Drizzle defs in `schema.ts`; idempotent DDL in `migrate.ts`)

All ids are `text` PKs; all `created_at` are `timestamptz default now()`.

| Table | Columns | Keys / indexes |
|---|---|---|
| `orgs` | `id`, `name`, `created_at` | PK `id` |
| `users` | `id`, `email` (citext-lower, unique), `name`, `password_hash` (nullable for invited-not-yet-set & SSO-only), `created_at` | PK `id`, **unique** `users_email_uq` on lower(email) |
| `sessions` | `id` (= the opaque token), `user_id` →users cascade, `created_at`, `last_seen_at`, `expires_at` (nullable = indefinite), `revoked_at` (nullable) | PK `id`, index `sessions_user_idx` |
| `memberships` | `id`, `user_id` →users cascade, `org_id` →orgs cascade, `org_role` (`admin`\|`member`), `created_at` | **unique** `memberships_user_org_uq`(user_id,org_id), index on user_id |
| `invitations` | `id`, `org_id` →orgs cascade, `email`, `org_role`, `project_assignments` jsonb (`[{projectId, role}]`), `token` (unique), `invited_by` →users, `created_at`, `expires_at`, `accepted_at` (nullable) | PK `id`, **unique** `invitations_token_uq`, index on (org_id,email) |
| `project_members` | `id`, `project_id` →projects cascade, `user_id` →users cascade, `project_role` (`pm`\|`super`\|`viewer`), `created_at` | **unique** `project_members_project_user_uq`(project_id,user_id), index on user_id |
| `stakeholder_orgs` | `id`, `org_id` →orgs cascade, `name`, `kind` (`owner`\|`architect`\|`engineer`\|`gc`\|`consultant`\|`lender`\|`sub`\|`other`), `created_at` | PK `id`, index `stakeholder_orgs_org_idx` |
| `stakeholder_contacts` | `id`, `stakeholder_org_id` →stakeholder_orgs cascade, `name`, `email`, `title` (nullable), `created_at` | PK `id`, index on stakeholder_org_id, index on email |
| `project_stakeholders` | `id`, `project_id` →projects cascade, `stakeholder_org_id` →stakeholder_orgs cascade, `created_at` | **unique**(project_id,stakeholder_org_id) — the per-project roster |
| `project_distribution_defaults` | `project_id` (PK) →projects cascade, `selection` jsonb (`{orgIds:[], contactIds:[]}`), `updated_at` | PK `project_id` — remembered last send (D-8) |
| `report_sends` | `id`, `report_id` →reports cascade, `sent_by` →users, `sent_at`, `message` (nullable) | PK `id`, index `report_sends_report_idx` |
| `report_send_recipients` | `id`, `send_id` →report_sends cascade, `contact_id` →stakeholder_contacts (nullable; null for ad-hoc one-off), `email`, `name`, `token` (unique), `expires_at`, `revoked_at` (nullable), `first_opened_at` (nullable), `last_opened_at` (nullable), `open_count` int default 0 | PK `id`, **unique** `rsr_token_uq`, index on send_id |

### 1.3 Alterations to existing tables

| Table | Add | Notes |
|---|---|---|
| `projects` | `org_id` text →orgs, `visibility` text default `'assigned'`, `created_at` timestamptz default now() | `org_id` nullable at first for backfill, then enforced in app logic (FK added after seed). |
| `reports` | `created_by` text →users (nullable) | The author, for self-finalize/authorship. Backfilled to the pilot super (§12). `super_name` stays as the display string. |

### 1.4 DDL workflow (per T-4)

For each new table: add the `pgTable(...)` def to `apps/server/src/db/schema.ts`, then append a `CREATE TABLE IF NOT EXISTS …` (+ `CREATE [UNIQUE] INDEX IF NOT EXISTS …`) block to the `DDL` string in `apps/server/src/db/migrate.ts`. For the two alters, add `ALTER TABLE … ADD COLUMN IF NOT EXISTS …`. `ensureSchema` splits on `;` and runs each at boot — safe to re-run. Order matters only for inline FK references in `CREATE TABLE` (create `orgs`/`users` before tables that FK them); to stay order-independent, FK the alters/new tables in app logic and keep the raw DDL FK-light where convenient (the existing code already omits the `reports→projects` cascade and relies on app logic).

---

## 2. Contracts (`packages/contracts`)

Bump `CONTRACTS_VERSION` → **`1.2.0`** and log in `DECISIONS.md` (the change protocol, schemas.ts §5). New additions are **additive**; existing shapes unchanged except `Report` gains optional `createdBy`, and `Project` gains optional `orgId` + `visibility`.

New schemas/types to add in `schemas.ts` (or a new `auth.ts` barreled from `index.ts`):

```ts
// roles
export const OrgRole = z.enum(['admin', 'member']);
export const ProjectRole = z.enum(['pm', 'super', 'viewer']);
export const ProjectVisibility = z.enum(['org', 'assigned']);
export const StakeholderKind = z.enum(['owner','architect','engineer','gc','consultant','lender','sub','other']);

// identity (public shapes — NEVER include password_hash)
export const PublicUser = z.object({ id: z.string(), email: z.string(), name: z.string().optional() });
export const Org = z.object({ id: z.string(), name: z.string() });
export const Membership = z.object({ orgId: z.string(), orgRole: OrgRole });
export const ProjectMember = z.object({ projectId: z.string(), userId: z.string(), role: ProjectRole, user: PublicUser.optional() });

// auth DTOs
export const SignupRequest = z.object({ email: z.string().email(), password: z.string().min(8), name: z.string().min(1), orgName: z.string().min(1) });
export const LoginRequest  = z.object({ email: z.string().email(), password: z.string().min(1) });
export const AcceptInviteRequest = z.object({ token: z.string(), name: z.string().min(1), password: z.string().min(8) });
export const AuthResponse  = z.object({ token: z.string(), user: PublicUser, orgs: z.array(Org.extend({ role: OrgRole })) });
export const Me            = z.object({ user: PublicUser, orgs: z.array(Org.extend({ role: OrgRole })) });

// project (extend existing Project)
//   Project += orgId: z.string().optional(), visibility: ProjectVisibility.default('assigned')

// stakeholder directory
export const StakeholderContact = z.object({ id: z.string(), name: z.string(), email: z.string().email(), title: z.string().optional() });
export const StakeholderOrg = z.object({ id: z.string(), name: z.string(), kind: StakeholderKind, contacts: z.array(StakeholderContact).default([]) });

// send + delivery
export const SendSelection = z.object({ orgIds: z.array(z.string()).default([]), contactIds: z.array(z.string()).default([]), adHoc: z.array(z.object({ name: z.string(), email: z.string().email() })).default([]) });
export const SendRequest = z.object({ selection: SendSelection, message: z.string().optional(), expiresInDays: z.number().int().positive().default(30) });
export const Recipient = z.object({ id: z.string(), name: z.string(), email: z.string(), org: z.string().optional(), sentAt: z.string(), firstOpenedAt: z.string().optional(), revokedAt: z.string().optional(), openCount: z.number().int() });
export const ReportSend = z.object({ id: z.string(), reportId: z.string(), sentBy: PublicUser, sentAt: z.string(), recipients: z.array(Recipient) });
```

The capture↔server **upload seam** (`UploadManifest`) stays as-is, but the upload endpoint becomes authenticated (§6.1): server derives `created_by` + `superName` from the session, and validates `projectId` against the caller's capture rights. `projectName` from the manifest is ignored for access (project must already exist + be assigned).

---

## 3. Repo interface additions (`db/types.ts` + `db/repo.ts`)

Grouped; all `Promise`-returning. (Types like `Org`, `PublicUser`, etc. come from contracts; internal `UserRow` includes `passwordHash`.)

```ts
// identity
createUser(u: { id; email; name; passwordHash?: string }): Promise<void>;
getUserByEmail(email: string): Promise<UserRow | null>;
getUserById(id: string): Promise<UserRow | null>;
setUserPassword(id: string, passwordHash: string): Promise<void>;

// sessions
createSession(s: { id; userId; expiresAt: Date | null }): Promise<void>;
getSession(token: string): Promise<{ userId: string; expiresAt: Date | null; revokedAt: Date | null } | null>;
touchSession(token: string): Promise<void>;          // last_seen_at = now (throttled)
revokeSession(token: string): Promise<void>;

// orgs + memberships
createOrg(o: { id; name }): Promise<void>;
getOrg(id: string): Promise<Org | null>;
addMembership(m: { id; userId; orgId; orgRole }): Promise<void>;
getMembership(userId: string, orgId: string): Promise<{ orgRole: OrgRole } | null>;
listOrgsForUser(userId: string): Promise<Array<Org & { role: OrgRole }>>;
listOrgMembers(orgId: string): Promise<Array<PublicUser & { orgRole: OrgRole; projects: ProjectMember[] }>>;

// invitations
createInvitation(i: { id; orgId; email; orgRole; projectAssignments; token; invitedBy; expiresAt }): Promise<void>;
getInvitationByToken(token: string): Promise<InvitationRow | null>;
markInvitationAccepted(id: string): Promise<void>;

// projects (extend)
listProjectsForUser(userId: string, orgId: string): Promise<Project[]>;   // visibility + membership aware
createProject(p: { id; orgId; name; superName; visibility }): Promise<void>;
setProjectVisibility(id: string, v: ProjectVisibility): Promise<void>;
getProjectOrgId(projectId: string): Promise<string | null>;
addProjectMember(pm: { id; projectId; userId; role }): Promise<void>;
removeProjectMember(projectId: string, userId: string): Promise<void>;
listProjectMembers(projectId: string): Promise<ProjectMember[]>;
getProjectRole(projectId: string, userId: string): Promise<ProjectRole | null>;

// reports (scoping)
listReportsForProject(projectId: string): Promise<Report[]>;
setReportCreatedBy(reportId: string, userId: string): Promise<void>;
// (existing getReport/applyEdit/finalize stay; authz is enforced in routes — §6)

// stakeholder directory
listStakeholderOrgs(orgId: string): Promise<StakeholderOrg[]>;            // with contacts
createStakeholderOrg(s: { id; orgId; name; kind }): Promise<void>;
updateStakeholderOrg(id: string, patch: { name?; kind? }): Promise<void>;
deleteStakeholderOrg(id: string): Promise<void>;
createStakeholderContact(c: { id; stakeholderOrgId; name; email; title? }): Promise<void>;
updateStakeholderContact(id: string, patch): Promise<void>;
deleteStakeholderContact(id: string): Promise<void>;
getContactsByIds(ids: string[]): Promise<Array<StakeholderContact & { orgName: string }>>;

// project roster + distribution defaults
listProjectStakeholders(projectId: string): Promise<StakeholderOrg[]>;    // the roster, with contacts
setProjectStakeholders(projectId: string, stakeholderOrgIds: string[]): Promise<void>;
getDistributionDefault(projectId: string): Promise<SendSelection | null>;
setDistributionDefault(projectId: string, selection: SendSelection): Promise<void>;

// sends + delivery
createReportSend(s: { id; reportId; sentBy; message? }): Promise<void>;
createRecipients(rs: Array<{ id; sendId; contactId?; email; name; token; expiresAt: Date }>): Promise<void>;
getRecipientByToken(token: string): Promise<RecipientRow & { reportId: string } | null>;
recordRecipientOpen(token: string): Promise<void>;     // first_opened_at ??=, last_opened_at, open_count++
revokeRecipient(id: string): Promise<void>;
listSendsForReport(reportId: string): Promise<ReportSend[]>;   // with recipients (delivery panel)
getReportLatestSendSummary(reportId: string): Promise<{ sentAt: string; opened: number; total: number } | null>; // list chip
```

---

## 4. Identity & auth

### 4.1 Building blocks (new modules under `apps/server/src/auth/`)

- `passwords.ts` — `hash(pw): Promise<string>` / `verify(hash, pw): Promise<boolean>` via `@node-rs/argon2`.
- `sessions.ts` — `issue(userId): Promise<token>` (random 32-byte base64url, persisted with `expires_at = null` if `auth.sessionTtlDays === 0` else now+ttl), `resolve(token): Promise<userId | null>` (checks revoked/expired; throttled `touchSession`).
- `context.ts` — Fastify decorator + `preHandler` that reads `Authorization: Bearer`, resolves the session, and sets `req.auth = { userId, user }` (or leaves it null). A `requireAuth` guard 401s when absent.
- `authz.ts` — the authorization helpers (§5).

### 4.2 Endpoints

| Method | Path | Auth | Body → Response | Notes |
|---|---|---|---|---|
| POST | `/api/auth/signup` | none | `SignupRequest` → `AuthResponse` | Creates `user`, `org`, `membership(admin)`; issues session. Rejects duplicate email. (D-5) |
| POST | `/api/auth/login` | none | `LoginRequest` → `AuthResponse` | argon2 verify; issues session. Generic 401 on bad creds. |
| POST | `/api/auth/logout` | session | — → 204 | `revokeSession`. |
| GET | `/api/auth/me` | session | → `Me` | Bootstraps the SPA (current user + orgs+roles). |
| GET | `/api/auth/invitations/:token` | none | → `{ orgName, email, orgRole }` | Preview for the accept screen. |
| POST | `/api/auth/invitations/accept` | none | `AcceptInviteRequest` → `AuthResponse` | Creates-or-updates the user (sets password+name), adds membership + project_members from `project_assignments`, marks accepted, issues session. |
| POST | `/api/orgs/:orgId/invitations` | org admin | `{ email, orgRole, projectAssignments }` → `{ token, inviteUrl }` | Sends invite email (link → web app `/<webBase>/accept?token=…`). |

Rate-limit login/signup/accept (basic in-memory throttle; note for ops). Passwords never logged; argon2 hashes never leave the server; `PublicUser` is the only user shape returned.

### 4.3 Session lifetime

`auth.sessionTtlDays` (env `SESSION_TTL_DAYS`, default `0` = indefinite per D-2). "Indefinite" sessions have `expires_at = null`; logout or admin action revokes. (Future: sliding expiry once cookies are viable.)

---

## 5. Authorization model

### 5.1 Roles & capabilities (enforced server-side)

| Capability | Org Admin | PM (project) | Super (project) | Viewer (project) | Org member (no project role) | External (token) |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Capture/upload to project | ✓ | ✓ | ✓ | — | — | — |
| Edit **own** draft report | ✓ | ✓ | ✓ | — | — | — |
| Edit/finalize **any** report on project | ✓ | ✓ | — | — | — | — |
| Finalize own report | ✓ | ✓ | ✓ | — | — | — |
| Send / revoke / resend | ✓ | ✓ | ✓ | — | — | — |
| View finalized reports | ✓ (all) | ✓ | ✓ | ✓ | ✓ *iff* `visibility='org'` | per-report link |
| View drafts (pre-finalize) | ✓ | ✓ | ✓ (own + project) | — | — | — |
| Manage project members / roster / visibility | ✓ | ✓ | — | — | — | — |
| Manage org (projects, members, billing), stakeholder directory | ✓ | — | — | — | — | — |

### 5.2 Enforcement helpers (`authz.ts`)

```ts
requireOrgAdmin(req, orgId)                  // membership.orgRole === 'admin'
requireProjectRole(req, projectId, roles[])  // org admin OR project_members.role ∈ roles
canViewReport(req, report)                   // org admin OR project role OR (visibility='org' && org member && report.status==='reviewed')
canEditReport(req, report)                   // org admin OR pm OR (super && report.createdBy === req.userId)
canFinalize  = canEditReport
canSend      = canEditReport                 // D-7: anyone who can finalize can send
```

Each existing route gets the matching guard (§6). All resolve the project via `getReportProjectId` → `getProjectOrgId` → membership/role lookups (cache per-request).

---

## 6. Tenancy scoping of the existing surface

Route-by-route change list (`routes.ts`). **Every currently-open route becomes guarded.**

### 6.1 Upload — `POST /api/upload`
- Add `requireAuth`. Resolve `projectId` from the manifest; **403 unless** `requireProjectRole(projectId, ['pm','super'])`. Set `created_by = req.userId`; override `superName` with the user's name. Reject if the project's org ≠ any of the user's orgs.

### 6.2 Reports list — **new** `GET /api/reports?projectId=…`
- `requireAuth` + `canView` on the project. Returns `listReportsForProject` filtered by visibility/role, each with a **latest-send summary** (`sentAt`, `opened/total`) for the status chip. Replaces the web app's use of `/api/admin/reports` for normal users.

### 6.3 Report read — `GET /api/reports/:id`
- `requireAuth` + `canViewReport`. 404 (not 403) when no access, to avoid leaking existence.

### 6.4 Edit — `PATCH /api/reports/:id`
- `requireAuth` + `canEditReport`. (Summary-regeneration + artifact invalidation unchanged.)

### 6.5 Finalize — `POST /api/reports/:id/finalize`
- `requireAuth` + `canFinalize`.

### 6.6 Hosted artifacts — **split**
- `GET /r/:id` and `/r/:id.pdf` → **internal**, now require `requireAuth` + `canViewReport` (used by the web app's "view"/preview). No longer open.
- **new** `GET /s/:token` and `/s/:token.pdf` → **external** capability URLs (§8.3). No session. Validates the recipient token (not revoked/expired), renders via `ensureArtifacts`, records the open. Serves expired/revoked HTML pages on failure.

### 6.7 Media — `GET /media/*`
- Currently open and returns raw bytes (local driver). Tighten: require a valid session **or** a valid share token in the referring context. Simplest correct approach: embed photos as data-URLs in the rendered report (already true for the PDF/HTML render), so `/media/*` is only needed for the admin raw-view → guard it behind `requireAuth` + org-admin. Confirm photos in the hosted HTML are self-contained (they are, per render pipeline) so external `/s/:token` needs no `/media` access.

### 6.8 Admin — `/api/admin/*`
- Keep, but re-gate: replace the static-token preHandler with `requireAuth` + **org-admin** (scoped to the admin's orgs). Optionally retain the static `ADMIN_TOKEN` as a break-glass **superadmin** that sees all orgs (ops/debugging) — keep it env-gated and off by default. (Confirm in §15.)

---

## 7. Stakeholder directory & distribution selection (D-8)

- **Directory** lives at **org level** (`stakeholder_orgs` + `stakeholder_contacts`), managed by org admins in Settings. Reusable across all the org's projects.
- **Roster**: each project references a subset via `project_stakeholders`. The Send modal only shows the project's roster (plus "+ add organization" to attach more from the directory or create new).
- **Selection model**: `SendSelection = { orgIds, contactIds, adHoc }`. Selecting an org = all its contacts; expanding lets you pick `contactIds`; `adHoc` = typed one-offs not yet in the directory (optionally promoted into the directory on send).
- **Remembered default**: on each successful send, persist the resolved selection to `project_distribution_defaults`; the Send modal pre-checks it next time (D-8). `GET` it to seed the modal.

---

## 8. Sending & delivery

### 8.1 Send — `POST /api/reports/:id/send`
`requireAuth` + `canSend`. Body `SendRequest`. Steps (transactional where possible):
1. Resolve the selection → a concrete list of `{ contactId?, name, email }` (dedupe by email).
2. Ensure the report is finalized (`status==='reviewed'`); if not, finalize first (reuses `renderAndStore(…, true)`), consistent with the capture "export=finalize" rule.
3. Create `report_sends` row (`sent_by`, `message?`).
4. For each recipient: mint a token (`tok_` + 32-byte base64url), `expires_at = now + expiresInDays`, insert `report_send_recipients`.
5. Persist `project_distribution_defaults`.
6. Send emails via the `EmailDriver` (best-effort, per-recipient; record failures but don't fail the whole send). From: `"<superName> via FieldReport" <reports@…>`, reply-to the sender's email; body links to `${publicBaseUrl}/s/<token>`.
7. Return the `ReportSend` (for the Delivery panel).

### 8.2 Delivery audit
- `GET /api/reports/:id/sends` → `ReportSend[]` with per-recipient `sentAt` / `firstOpenedAt` / `openCount` / `revokedAt` (D-9). Drives the Delivery panel + the list-row "opened X/Y" chip (via `getReportLatestSendSummary`).
- `POST /api/reports/:id/recipients/:rid/revoke` → `revokeRecipient` (link 410s thereafter).
- `POST /api/reports/:id/recipients/:rid/resend` → re-send the same token email (or mint a fresh one if expired).

### 8.3 External access — `/s/:token`
- `GET /s/:token`: resolve token → recipient+report. If revoked → 410 page; if expired → 410 page ("link expired — ask the sender for a new one"). Else `ensureArtifacts(reportId)`, `recordRecipientOpen(token)` (sets `first_opened_at` once), return the hosted HTML with a thin "shared with you · read-only · expires <date>" banner + a Download-PDF link to `/s/:token.pdf`.
- `GET /s/:token.pdf`: same validation, stream the PDF (no extra open recorded, or count as open — pick one; recommend HTML view = the canonical "opened").
- `cache-control: no-cache` (same as today's `/r`).

### 8.4 Open-tracking semantics
"Opened" = first successful `GET /s/:token` (HTML). `open_count`/`last_opened_at` updated on every load. This is honest (no tracking pixel) and works precisely because delivery is link-only (D-9).

---

## 9. Email + links infrastructure

- **Driver seam** `apps/server/src/email/` → `types.ts` (`EmailDriver { name; send(msg) }`), `resend.ts`, `mock.ts`, `index.ts` (`makeEmail(config)` → resend when `RESEND_API_KEY` present, else mock). Wired into `ServerDeps`.
- **Templates** `email/templates.ts`: `shareEmail({ report, recipient, sender, link })` → `{ subject, html, text }`. Subject e.g. `Daily field report — Watson Island — Jun 28`. Plain, on-brand (blue, IBM Plex), one clear button to the link, sender's name + "via FieldReport", reply-to sender.
- **From identity** (D-9): `EMAIL_FROM="FieldReport <reports@fieldreport.app>"`; display name overridden per-send to `"<superName> via FieldReport"`; `replyTo` = sender's email.
- **Domain**: verify `fieldreport.app` (or chosen domain) in Resend (SPF/DKIM/DMARC DNS) — **ops prerequisite** before real sends; mock driver covers dev.
- **Link base**: `${publicBaseUrl}` (the Render server hosts `/s/:token`). Invite links target the **web app** base (`WEB_BASE_URL`) `/accept?token=…`.

---

## 10. Config & env additions (`config.ts`)

```
# auth
SESSION_TTL_DAYS=0                 # 0 = indefinite
# email
RESEND_API_KEY=...                 # absent → mock driver
EMAIL_FROM="FieldReport <reports@fieldreport.app>"
EMAIL_PROVIDER=resend|mock         # optional force, like STT_PROVIDER
# links
WEB_BASE_URL=https://app.fieldreport.app   # for invite-accept links
# (PUBLIC_BASE_URL / RENDER_EXTERNAL_URL already exist → /s/:token base)
# cors
CORS_ALLOWED_ORIGINS=https://app...,https://capture...   # comma list (see §11)
# pilot bootstrap (seed org/admin; §12)
PILOT_ORG_ID=org_pilot
PILOT_ORG_NAME="Watson Builders"
PILOT_SUPER_EMAIL=super@example.com
PILOT_SUPER_PASSWORD=...           # one-time; or leave unset and use an invite
```

Add to `config` an `auth`, `email`, `app.webBaseUrl`, and `cors.allowedOrigins` block. Secrets via Render env (`sync:false`); never commit (consistent with current `.env`/render.yaml handling).

---

## 11. CORS / security hardening

- Replace `cors({ origin: true })` with an **allowlist** from `CORS_ALLOWED_ORIGINS` (the Vercel capture + web origins), still without credentials (bearer tokens don't need cookies). Keep `origin: true` only in dev/local.
- Add a lightweight per-IP rate limit on `/api/auth/*` and `/s/:token` (in-memory token bucket; note ops upgrade path to `@fastify/rate-limit`).
- Argon2id params tuned for ~50–100ms server cost.
- Tokens: 256-bit random, base64url; share tokens are capability URLs (treat as secrets in transit; `no-store` on the `/s` HTML if we don't want CDN caching of authed content).

---

## 12. Migration, backfill & pilot seeding

Done idempotently at boot in `deps.ts` (after `ensureSchema`), replacing today's `upsertProject(pilot)`:

1. `ensureSchema` creates the new tables + alters.
2. **Seed org**: upsert `orgs(PILOT_ORG_ID, PILOT_ORG_NAME)`.
3. **Seed admin user**: if `PILOT_SUPER_EMAIL` set and no user → `createUser` with `argon2(PILOT_SUPER_PASSWORD)` (or create a pending user + log an invite link if no password). Add `membership(admin)`.
4. **Adopt the pilot project**: `UPDATE projects SET org_id = PILOT_ORG_ID WHERE org_id IS NULL`; ensure the existing pilot project row exists (current `upsertProject`), default `visibility='assigned'`; `addProjectMember(pilotProject, superUser, 'super')` (or `pm`).
5. **Backfill reports**: `UPDATE reports SET created_by = <superUser> WHERE created_by IS NULL`.
6. Existing hosted links (`/r/:id`) keep working for logged-in members; external recipients use new `/s/:token` going forward (no retroactive tokens needed).

This guarantees the live pilot (Render, Neon) keeps functioning the moment the migration ships, with the super able to log in.

---

## 13. Testing plan

Unit/integration (Vitest, matching `apps/server/test/*`):
- **authz matrix**: a fixture org with admin/pm/super/viewer/non-member + two projects (`org` vs `assigned` visibility); assert every cell of §5.1 (view/edit/finalize/send) returns the right 200/403/404.
- **sessions**: issue/resolve/revoke; indefinite vs ttl; expired/revoked → 401.
- **signup/login/invite-accept**: happy paths + duplicate email, bad creds, expired invite.
- **upload scoping**: non-member 403; member super sets `created_by`/`superName`.
- **send flow**: selection → recipients, tokens minted, distribution default persisted, mock email captured; finalize-on-send.
- **/s/:token**: valid → renders + records first-open once; revoked → 410; expired → 410; open_count increments.
- **migration/backfill**: fresh DB seeds org/admin/project/member; existing-data backfill sets `created_by` + `org_id`.
- Update existing tests that assumed open routes (they'll now need a session/token fixture).

---

## 14. Environments, phasing & phase playbooks

### 14.1 Working model — compaction & cold handoff

**The conversation is compacted after every phase. This file is the durable context; the chat is not.** Therefore each phase below is a **self-contained execution packet** — goal, what prior phases delivered, what to read, exactly what to build, what not to break, how to verify, and exit criteria. Everything needed lives in this file (which persists on disk) plus the cited source files.

- **To start any phase (cold, post-compaction):** the kickoff prompt is literally — *"Read `AUTH_MULTITENANCY_PLAN.md` top to bottom, then execute Phase N. Build on the `develop` branch. Update the build tracker (§14.4) when done."* The reader re-reads §0–§13 (the spec) + the phase playbook; no reliance on prior chat.
- **At the end of every phase:** update the build tracker (§14.4), commit to `develop`, and (at milestones) deploy to dev/staging. Leftover chat context after compaction is a bonus, never required.
- **One phase = one context window = one compaction unit.** Phases are sequential on a single branch (`develop`) — there is no parallel-branch work, so there is never a merge conflict between phases.

### 14.2 Environments

Three tiers. **The dev/staging tier has its own database and its own object storage** — non-negotiable: this is a breaking schema migration and it must never touch the live pilot's data.

| | Local | Dev / staging (NEW — build here) | Production (LIVE — do not disturb) |
|---|---|---|---|
| Purpose | build + unit-test each phase | integration-verify before promotion | the pilot |
| Server | `npm run dev:server` (`localhost:8787`) | Render `fieldreport-server-dev`, deploys from `develop` → `<DEV_SERVER_URL>` | Render `fieldreport-server` (`https://fieldnotes-yglr.onrender.com`), deploys from `master` |
| DB | pglite (`.data/pglite`) | **separate Neon DB** `fieldreport-dev` (empty, seeded) | Neon (prod) |
| Storage | local disk (`.data/storage`) | **separate R2 bucket** `fieldreport-media-dev` | R2 (prod) |
| STT / LLM | mock | real keys *or* mock (your call) | real keys |
| Email | mock | Resend **test** key or mock | Resend live (verified domain) |
| Web / capture | localhost | Vercel `*-dev` projects, `VITE_API_BASE=<DEV_SERVER_URL>` | Vercel prod projects → prod server |
| Branch | any | `develop` | `master` |

Day-to-day: **build + test each phase locally** (pglite + mocks + Vitest — already fully supported, no accounts needed). Deploy to **dev/staging** at the integration milestones (Phases 4, 8, and the frontend phases) to verify against real Render + Neon + R2. **Promote to prod only when you say so.**

### 14.3 Branch & promotion workflow

- Cut **`develop`** from `master` in Phase 0. All phase work lands on `develop`; never commit feature work to `master`.
- The dev Render service auto-deploys `develop`; verify on `<DEV_SERVER_URL>/healthz`.
- **Promote (you control each one):** when a milestone is verified on dev, merge `develop → master`. Render prod auto-deploys; then redeploy the Vercel prod apps **server-first** (per `DEPLOY.md`); confirm `GET /healthz` shows the new `commit`. Before the first prod promotion of an auth-bearing phase, set the new prod env (e.g. `PILOT_SUPER_EMAIL/PASSWORD`, `CORS_ALLOWED_ORIGINS`, `SESSION_TTL_DAYS`, later `RESEND_API_KEY`/`EMAIL_FROM`).
- Migration safety: the DDL is **idempotent + additive** and the backfill runs in the boot seed (§12), so a prod promotion self-migrates on boot — but always promote server-first.

### 14.4 Build tracker

Legend: ⬜ todo · 🟡 in progress · ✅ done (on `develop`) · 🚀 promoted to prod.

- 🟡 **Phase 0** — Dev/staging environment. Repo side ✅ on `develop` (`render.dev.yaml`, `cors.allowedOrigins` in config, `.env.dev.example` ×3, `DEV_ENV.md`). Awaiting the human dashboard steps (Neon-dev DB, R2-dev bucket, Render-dev service, 2× Vercel-dev projects) per `DEV_ENV.md` → then record `<DEV_SERVER_URL>` + dev SPA URLs here.
- ⬜ **Phase 1** — Foundation: deps + config + `newId`; schema + idempotent DDL; contracts `1.2.0`
- ⬜ **Phase 2** — Repo methods (§3)
- ⬜ **Phase 3** — Auth core (passwords, sessions, `req.auth`, signup/login/logout/me) + CORS allowlist
- ⬜ **Phase 4** — Pilot seed/backfill + authz + scope every existing route + reports-list  ← **milestone: app fully auth-gated; prod-promotable**
- ⬜ **Phase 5** — Email driver seam (resend + mock) + templates
- ⬜ **Phase 6** — Invitations (create + accept)
- ⬜ **Phase 7** — Stakeholder directory + project roster + distribution defaults
- ⬜ **Phase 8** — Send + delivery + `/s/:token` + open-tracking + revoke/resend  ← **milestone: distribution end-to-end; prod-promotable**
- ⬜ **Phase 9 (F1)** — Web: auth screens + app shell/switchers + reports list *(needs design zip)*
- ⬜ **Phase 10 (F2)** — Web: Send modal + Delivery panel + Settings *(needs design zip)*
- ⬜ **Phase 11 (F3)** — Capture: login + project picker + authed upload *(needs design zip)*
- ⬜ **Phase 12 (F4)** — External recipient view + email styling *(needs design zip)*

### 14.5 Phase playbooks

Each playbook is written to be executed cold. Format: **Goal · Starting state · Read first · Build · Don't break · Verify · Done when.**

---

#### Phase 0 — Dev / staging environment

- **Goal:** stand up an isolated dev copy of the whole app (own URL, own DB, own storage) so every later phase is built and verified off-prod; cut the `develop` branch.
- **Starting state:** prod is live on `master` — Render `fieldreport-server` (`fieldnotes-yglr.onrender.com`) + Neon (prod) + R2 (prod) + two Vercel projects (capture, web). No dev env exists. Deploy mechanics are in `DEPLOY.md`; the Render blueprint is `render.yaml`.
- **Read first:** §14.2, §14.3 above; `DEPLOY.md`; `render.yaml`; `apps/server/.env.example`; `apps/{capture,web}/.env.example` + `vercel.json`.
- **Build (repo — I do these):**
  1. `git checkout -b develop` (from `master`).
  2. `render.dev.yaml` — a second Render web service `fieldreport-server-dev`: same `dockerfilePath`/`dockerContext`, `branch: develop`, `autoDeploy: true`, `healthCheckPath: /healthz`, all secret env `sync:false` (dev `DATABASE_URL`, dev `S3_*`, dev `ADMIN_TOKEN`, AI keys, `RESEND_API_KEY`, `CORS_ALLOWED_ORIGINS`, `SESSION_TTL_DAYS`, dev `PILOT_*`). Keep `render.yaml` (prod) untouched.
  3. `config.ts`: add `cors.allowedOrigins` parsed from `CORS_ALLOWED_ORIGINS` (comma list); CORS uses the allowlist when set, else `origin:true` (local). *(This is the only code change in Phase 0 — small + backward-compatible.)*
  4. `apps/server/.env.dev.example` + `apps/{capture,web}/.env.dev.example` (`VITE_API_BASE=<DEV_SERVER_URL>`, capture also `VITE_WEB_BASE=<web-dev URL>`).
  5. A short `DEV_ENV.md` runbook capturing the dashboard steps + the resulting URLs.
- **Human steps (dashboards — you do these; I can't click UIs or handle credentials):**
  1. **Neon:** create DB `fieldreport-dev` (new project or branch) → copy its `DATABASE_URL`.
  2. **R2:** create bucket `fieldreport-media-dev` + API token → endpoint + keys.
  3. **Render:** New → Blueprint `render.dev.yaml` (or New Web Service, Docker, branch `develop`); paste the dev secrets; deploy → record `<DEV_SERVER_URL>`.
  4. **Vercel:** two new projects (capture-dev, web-dev) from this repo, production branch `develop`, root dirs `apps/capture` / `apps/web`, `VITE_API_BASE=<DEV_SERVER_URL>`; deploy → record dev URLs; put those origins in the dev server's `CORS_ALLOWED_ORIGINS` and redeploy.
- **Don't break:** never point the dev server at the prod Neon DB or prod R2 bucket; do **not** merge `develop → master`. Prod stays exactly as is.
- **Verify:** `GET <DEV_SERVER_URL>/healthz` → `ok`, `commit` = `develop` HEAD, and DB/storage are the dev ones; capture-dev/web-dev load and reach the dev API.
- **Done when:** `develop` exists; the dev server runs on its own URL with its own empty Neon DB + R2 bucket; dev Vercel apps target it; prod untouched. (Note: phases 1–3 don't strictly need the dev server — they're local-first — but having it now means milestone deploys at Phase 4/8 are one step.)

---

#### Phase 1 — Foundation (schema + contracts)

- **Goal:** add every new table + the two alters (§1) via idempotent DDL, and bump contracts to `1.2.0` (§2). No behavior/route change.
- **Starting state:** Phase 0 done (`develop` + dev env). Current schema = `projects`, `reports`, `observations`, `photos` (`apps/server/src/db/schema.ts`); idempotent DDL lives in `apps/server/src/db/migrate.ts` (`ensureSchema`). Contracts are frozen at `1.1.0` in `packages/contracts/src/schemas.ts`.
- **Read first:** §0.2, §0.3, §1 (all), §2; `schema.ts`, `migrate.ts`; `packages/contracts/src/{schemas.ts,index.ts}`; `apps/server/src/ids.ts`, `config.ts`.
- **Build:**
  1. Deps: `npm i @node-rs/argon2 resend -w apps/server`.
  2. `ids.ts`: add `newId(prefix)` (`crypto.randomUUID`-based) — T-6.
  3. `config.ts`: add `auth`, `email`, `app.webBaseUrl` blocks reading §10 env (all optional locally → mocks). (`cors.allowedOrigins` already added in Phase 0.)
  4. `schema.ts`: add the 13 tables (§1.2) + the two alters (§1.3) as Drizzle defs.
  5. `migrate.ts`: append idempotent DDL — `CREATE TABLE IF NOT EXISTS …`, `CREATE [UNIQUE] INDEX IF NOT EXISTS …`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS …` — per §1.4.
  6. Contracts: add schemas/types (§2); set `CONTRACTS_VERSION='1.2.0'`; export from `index.ts`; log the bump in `DECISIONS.md`.
- **Don't break:** additive only. Existing tables/columns unchanged except the two new nullable columns. `ensureSchema` must still run clean (idempotent) against a prod-shaped DB. Do **not** add NOT NULL/FK constraints to existing columns yet — backfill is Phase 4.
- **Verify:** `npm run build:contracts`; server typecheck; `npm run dev:server` boots (pglite creates the new tables); existing `apps/server/test/*` still green; `npm run dryrun` still emits a report.
- **Done when:** schema + contracts compile and boot locally with all new tables present; zero route/behavior change.

---

#### Phase 2 — Repo methods

- **Goal:** implement every new repo method (§3) over the Phase 1 schema.
- **Starting state:** Phase 1 tables + contracts exist; no repo methods for them yet.
- **Read first:** §3; `apps/server/src/db/repo.ts` (write/transaction patterns, `assembleReport`), `apps/server/src/db/types.ts` (the `Repo` interface).
- **Build:** extend the `Repo` interface (`types.ts`) + `makeRepo` (`repo.ts`) with the §3 methods, grouped (identity · sessions · orgs/memberships · invitations · projects · reports-scoping · stakeholder directory · roster/defaults · sends/delivery). Reuse the existing Drizzle DSL + `db.transaction` for multi-row writes.
- **Don't break:** pure additions; existing repo methods unchanged.
- **Verify:** typecheck; add `apps/server/test/repo-auth.test.ts` exercising CRUD for each new entity against pglite (org → user → membership → project_member; stakeholder org + contacts + roster + default; report_send + recipients + open-record). Green.
- **Done when:** all §3 methods implemented and unit-tested.

---

#### Phase 3 — Auth core

- **Goal:** passwords, sessions, request auth context, the auth endpoints (§4), and the CORS allowlist (§11). Routes are **not** guarded yet.
- **Starting state:** Phases 1–2 (schema, contracts, repo). `apps/server/src/app.ts` registers `cors`+`multipart` only; no `req.user`/decorators; the only auth is the static admin-token preHandler in `routes.ts`.
- **Read first:** §4, §10, §11, §0.3 (T-1/T-2); `app.ts`, `routes.ts` (registration patterns), `config.ts`.
- **Build:**
  1. `auth/passwords.ts` — argon2id `hash`/`verify` (`@node-rs/argon2`).
  2. `auth/sessions.ts` — `issue(userId)` (random 32-byte base64url; `expires_at` = null when `SESSION_TTL_DAYS=0`), `resolve(token)` (reject revoked/expired; throttled `touchSession`), `revoke`.
  3. `auth/context.ts` — Fastify decorator + global `preHandler` that sets `req.auth = { userId, user }` when a valid `Authorization: Bearer` session is present (never 401s globally); export a `requireAuth` guard.
  4. Register the decorator/preHandler in `app.ts`.
  5. Routes `/api/auth/{signup,login,logout,me}` (§4.2), wired through `ServerDeps`.
  6. Replace `cors({ origin:true })` with the allowlist from `cors.allowedOrigins` (keep `origin:true` only when the list is empty/local) (§11).
- **Don't break:** existing routes still function (no guards added here — that's Phase 4); ensure local + dev origins are in the allowlist (or unset → permissive) so the SPAs still reach the API.
- **Verify:** tests — signup (dup email → 409), login (bad creds → generic 401), `me`, logout (revoke → subsequent 401); typecheck; local smoke (`curl` signup → token → `me` → logout).
- **Done when:** a user can sign up / log in / `me` / log out against local (and the dev server if deployed); sessions persist and revoke.

---

#### Phase 4 — Authz + route scoping + pilot seed  (MILESTONE)

- **Goal:** gate every existing route by membership/role (§5, §6) and seed/backfill the pilot (§12) so the live data keeps working once gated. After this the app is fully multi-tenant.
- **Starting state:** Phases 1–3 (auth works; routes still open). Seed today is `upsertProject(pilot)` in `deps.ts`.
- **Read first:** §5 (matrix + helpers), §6 (route-by-route), §12 (seed/backfill); `routes.ts`, `deps.ts`, `pipeline.ts` (upload path), `ingest/*`.
- **Build:**
  1. `auth/authz.ts`: `requireOrgAdmin` / `requireProjectRole` / `canViewReport` / `canEditReport` / `canFinalize` / `canSend` (§5.2), resolving project→org→membership/role per request (cache per request).
  2. Guard every route per §6: upload (member + capture role; set `created_by` + `superName` from session); **new** `GET /api/reports?projectId` (scoped list + latest-send summary); report read/edit/finalize (`canView`/`canEdit`/`canFinalize`); split hosted `/r/:id` → authed-internal (leave `/s/:token` for Phase 8); gate `/media/*`; re-gate `/api/admin/*` to org-admin (keep static `ADMIN_TOKEN` as off-by-default superadmin — §15.3).
  3. Seed/backfill in `deps.ts` (§12): seed org from `PILOT_ORG_*`; create pilot admin user (`PILOT_SUPER_EMAIL`/`PILOT_SUPER_PASSWORD`) + `membership(admin)`; adopt the pilot project (`org_id`, `visibility='assigned'`, add the super as `project_member`); backfill `reports.created_by`. Idempotent.
- **Don't break:** the seed MUST run before/with gating so the pilot super can log in and reach existing reports. The removal of public `/r/:id` is **intentional** — external access returns in Phase 8 via `/s/:token`; do not "fix" it by reopening `/r`. Keep everything idempotent.
- **Verify:** full authz-matrix test (§13) + seed/backfill test (fresh + existing-data). Local smoke: log in as the pilot admin → list/read/edit/finalize. Then **deploy to dev/staging** and re-run the smoke against `<DEV_SERVER_URL>`.
- **Done when:** every route guarded; the pilot admin works end-to-end on dev; tests green. **Prod-promotable** — before promoting, set prod `PILOT_SUPER_EMAIL/PASSWORD`, `CORS_ALLOWED_ORIGINS`, `SESSION_TTL_DAYS`; promote server-first; the boot seed migrates prod.

---

#### Phase 5 — Email driver seam

- **Goal:** pluggable email (§9): `resend` + `mock` providers + templates.
- **Starting state:** Phases 1–4. No email anywhere. `resend` dep added in Phase 1.
- **Read first:** §9; `apps/server/src/storage/index.ts` (the `makeX` driver-selection pattern), `deps.ts`, `config.ts`.
- **Build:** `apps/server/src/email/{types,resend,mock,templates,index}.ts`; `makeEmail(config)` → `resend` when `RESEND_API_KEY` present else `mock` (writes `.eml`/JSON under `.data` + logs); wire `email` into `ServerDeps`; `shareEmail` + `inviteEmail` templates (§9, on-brand).
- **Don't break:** mock is the default; nothing requires a key locally.
- **Verify:** unit test — mock send captures the message; templates render subject/html/text; typecheck.
- **Done when:** `deps.email.send(...)` works; both templates render.

---

#### Phase 6 — Invitations

- **Goal:** invite create + accept (§4.2) using the email seam.
- **Starting state:** Phases 1–5 (auth + email + repo invitations methods).
- **Read first:** §4.2, §12 (roles), §7; `routes.ts` auth section.
- **Build:** `POST /api/orgs/:orgId/invitations` (org admin → token + `inviteUrl`, sends invite email), `GET /api/auth/invitations/:token` (preview), `POST /api/auth/invitations/accept` (create/update user, add membership + project_members from `project_assignments`, mark accepted, issue session).
- **Don't break:** accept must be idempotent-safe against an already-existing user (adds membership, doesn't duplicate).
- **Verify:** tests — invite → accept happy path; expired/invalid token; accept assigns the right org + project roles; mock invite email captured.
- **Done when:** an admin can invite by email and the invitee lands in the app with correct roles.

---

#### Phase 7 — Stakeholder directory + roster + defaults

- **Goal:** org-level directory CRUD + per-project roster + remembered distribution default (§7).
- **Starting state:** Phases 1–4 (repo stakeholder methods exist).
- **Read first:** §7, §1.2 (stakeholder tables), §3 (repo methods).
- **Build:** endpoints — list/create/update/delete stakeholder orgs + contacts (org admin); get/set a project's roster (`project_stakeholders`); get/set `project_distribution_defaults`. Authz via `requireOrgAdmin` (directory) / `requireProjectRole(['pm'])` (roster).
- **Don't break:** deleting a stakeholder org/contact must not orphan past `report_send_recipients` (they store a denormalized `email`/`name`, and `contact_id` is nullable) — keep the FK `ON DELETE SET NULL` or guard in app logic per §1.2.
- **Verify:** tests — directory CRUD; roster set/get; default persist/read.
- **Done when:** directory + roster + remembered default are usable via API.

---

#### Phase 8 — Send + delivery + external links  (MILESTONE)

- **Goal:** the full distribution flow (§8): send, per-recipient tokens, emails, `/s/:token(.pdf)`, open-tracking, revoke/resend, delivery audit.
- **Starting state:** Phases 1–7 (auth, email, directory, repo send/delivery methods).
- **Read first:** §8 (all), §9, §7; `routes.ts` (`ensureArtifacts`, the `/r` handlers, `invalidateArtifacts`), `pipeline.ts` (`renderAndStore`).
- **Build:** `POST /api/reports/:id/send` (`canSend`; resolve `SendSelection`→recipients, dedupe; finalize-if-needed; mint tokens; persist distribution default; send emails best-effort); `GET /api/reports/:id/sends` (delivery audit); `POST …/recipients/:rid/{revoke,resend}`; external `GET /s/:token` + `/s/:token.pdf` (validate not-revoked/not-expired, `ensureArtifacts`, record open once, expired/revoked HTML pages); wire the list-row `getReportLatestSendSummary`.
- **Don't break:** `/s/:token` is intentionally unauthenticated (capability URL). Confirm the hosted HTML embeds photos as data-URLs (it does) so external viewers need no `/media` access. `recordRecipientOpen` sets `first_opened_at` only once.
- **Verify:** tests — send → tokens + mock emails + default persisted; `/s` valid → renders + records first-open once; revoked/expired → 410; resend; open_count increments. Then **deploy to dev**, send a real test report to your own inbox via a Resend test key, open it, confirm the open shows in the delivery audit.
- **Done when:** send works end-to-end on dev. **Prod-promotable** — set prod `RESEND_API_KEY` + verified `EMAIL_FROM` domain first.

---

#### Phases 9–12 (F1–F4) — Frontend

Each F-phase needs **(a)** the Claude Design zip extracted to `.design-handoff/auth-ui/` (gitignored) and **(b)** the matching backend endpoints from Phases 3–8. Per phase: read the design README + the relevant `DESIGN_BRIEF_AUTH.md` section, implement in `apps/web` / `apps/capture` using the existing `styles.css` tokens, wire to the endpoints, verify with the preview workflow, deploy to dev, then promote with the backend. Fixed scope:

- **Phase 9 (F1)** — Web: auth screens (signup/login/accept-invite) + app shell (org/project switchers, user menu) + reports list. *Needs Phases 3–4.*
- **Phase 10 (F2)** — Web: Send/distribution modal + Delivery panel + Settings (members & roles, project visibility, stakeholder directory). *Needs Phases 6–8.*
- **Phase 11 (F3)** — Capture: login + project picker + authenticated upload (preparer/project now from account+picker, not free text). *Needs Phases 3–4.*
- **Phase 12 (F4)** — External recipient view shell (Download PDF, expired/revoked states) + email styling. *Needs Phase 8.*

The detailed per-screen playbook for F1–F4 will be filled in from the design README when the zip lands; the backend contract they bind to is already fixed in §2–§9.

---

## 15. Open decisions (recommendations in **bold**)

1. ✅ **Email provider = Resend** (mock driver for dev). *Resolved.*
2. 🟡 Session mechanism = **bearer token in localStorage** (T-1), with the cookie upgrade reserved for when same-site custom domains exist. Explained to the user; proceeding on bearer as the default unless they say otherwise.
3. Keep the static `ADMIN_TOKEN` as a break-glass **superadmin**? **Yes, env-gated / off by default** (proceeding on this) vs remove entirely.
4. Default link expiry **30 days** (D-9) — proceeding on 30d; can later expose as a per-org configurable default.
5. Pilot admin bootstrap — **env password** (`PILOT_SUPER_PASSWORD`) for first login, rotate after (proceeding) vs invite-link-only. *Needed before the Phase 4 prod promotion, not before building.*
6. Sending **domain** to verify in Resend (`fieldreport.app`?) — **needed only before the first real send (Phase 8 prod), not before building.** Dev uses the mock/Resend-test path.

---

## 16. Future (post-this-phase)

SSO providers (add `auth_identities` table; same `users`) · per-org custom sending domains · same-site custom domains → switch to httpOnly cookies · field-level edit audit / report versioning · the agentic "ask about this report" layer (hosted report page is the entry point) · org-level billing.

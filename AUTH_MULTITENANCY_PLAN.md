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
| Storage | local disk (`.data/storage`) | **separate R2 bucket** `fieldreport-dev` | R2 (prod) |
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

- ✅ **Phase 0** — Dev/staging environment (fully stood up 2026-07-08). Repo side (`render.dev.yaml`, `cors.allowedOrigins`, `.env.dev.example` ×3, `DEV_ENV.md`) + all dashboards: **server `https://fieldreport-server-dev.onrender.com`** (Render, branch `develop`, auto-deploy; `/healthz` → `storage:"s3"`), Neon `fieldreport-dev` DB, R2 bucket `fieldreport-dev` (endpoint `https://1aa5859de5ebf1cc2299702e8f2ee1a1.r2.cloudflarestorage.com`; gotchas hit: bucket name ≠ runbook placeholder, R2 shows 3 credentials — Access Key ID is the 32-hex one — and swapped keys fail as "access key has length 64"), **web `https://fieldreport-web-dev.vercel.app`**, **capture `https://fieldreport-capture-dev.vercel.app`** (both Vercel, production branch `develop`, `VITE_API_BASE` set; capture also `VITE_WEB_BASE`), CORS allowlist + `WEB_BASE_URL` closed on the server. Verified by `apps/server/scripts/smoke-dev.mjs` — **23/23**: signup → project → authed multipart upload (R2 write) → mock pipeline ready → report read → finalize → hosted HTML (session-gated, anon 401) → PDF (80 KB, Chromium on Render) → send + delivery audit (no token leak) → invitation (inviteUrl targets web-dev) → `/s` bad-token page → CORS allow×2/block×1 → SPA serve + deep-link rewrites. Mock STT/synthesis/email (no AI/Resend keys yet — add for full-fidelity testing). *Hygiene TODO before prod-like use: roll the R2 token + rotate the Neon password (both transited chat during setup).*
- ✅ **Phase 1** — Foundation: deps + config + `newId`; schema + idempotent DDL; contracts `1.2.0` (D20). 12 new tables + 2 nullable alters; verified: contracts build, typecheck, 28/28 tests, dryrun.
- ✅ **Phase 2** — Repo methods (§3). All groups implemented in `db/{types,repo}.ts` (pure additions); `test/repo-auth.test.ts` covers CRUD per entity (23 tests, 51/51 green).
- ✅ **Phase 3** — Auth core (passwords, sessions, `req.auth`, signup/login/logout/me) + CORS allowlist. `auth/{passwords,sessions,context,routes}.ts`; `sessions` in `ServerDeps`; routes still unguarded (Phase 4). Verified: 66/66 tests (15 new HTTP-level) + live local smoke (signup→me→logout, dup→409, bad creds→401).
- ✅ **Phase 4** — Pilot seed/backfill + authz + scope every existing route + reports-list  ← **milestone: app fully auth-gated; prod-promotable**. `auth/authz.ts` (§5.2, per-request cache); every route guarded per §6 incl. new `GET /api/reports?projectId` + admin re-gate (org-admin scoped; `ADMIN_BREAK_GLASS` off by default); `seedPilot` in deps.ts (§12, idempotent). 88/88 tests (16 authz-matrix + 4 seed). *Dev-staging smoke pending the Phase 0 dashboard steps; prod promotion needs prod `PILOT_SUPER_EMAIL/PASSWORD` + `CORS_ALLOWED_ORIGINS` + `SESSION_TTL_DAYS` set first.*
- ✅ **Phase 5** — Email driver seam (resend + mock) + templates. `email/{types,mock,resend,templates,index}.ts`; `deps.email` wired; `shareEmail` + `inviteEmail` render subject/html/text; mock captures + writes `.data/email`. 93/93 tests.
- ✅ **Phase 6** — Invitations (create + accept). `auth/invitations.ts`: create (org admin; assignments locked to the org; invite email best-effort; 14d expiry), preview, accept (create-or-activate user; NEVER overwrites an active account's credentials — invite only adds membership); throttled like login/signup. 103/103 tests.
- ✅ **Phase 7** — Stakeholder directory + project roster + distribution defaults. `directory.ts`: org-admin directory CRUD (orgs + contacts, org-scoped — cross-org ids 404); per-project roster (`PUT/GET`, pm/admin write, send-capable read, roster entries validated to the project's org); `GET/PUT` distribution default. `authz.canManageProject`; repo ownership helpers (`getStakeholder{Org,Contact}OrgId`). Deleting a directory entry preserves the delivery audit (denormalized email/name; `contact_id` SET NULL). Contracts += directory/roster request DTOs. 115/115 tests (7 new). *(Also: a full xhigh code-review hardening pass on Phases 4–6 landed first — `a9e5629`.)*
- ✅ **Phase 8** — Send + delivery + `/s/:token` + open-tracking + revoke/resend  ← **milestone: distribution end-to-end; prod-promotable**. `send.ts`: `POST /api/reports/:id/send` (canSend; resolve selection→deduped recipients, tenancy-safe; finalize-on-send; mint `tok_` capability links; persist default; best-effort per-recipient email), `GET …/sends` (delivery audit), `…/recipients/:rid/{revoke,resend}`; external `GET /s/:token(.pdf)` (throttled, no session; revoked/expired → 410 pages; records first-open once; hosted HTML self-contained). `ensureArtifacts` hoisted to `pipeline.ts` (shared with `/r`). Repo += `resolveSelectionContacts` / `getRecipientById` / `refreshRecipientToken`. 124/124 tests (9 new). *Dev-staging smoke + a real Resend open-tracking test pending the Phase 0 dashboards; prod promotion still needs prod `PILOT_SUPER_*` + `CORS_ALLOWED_ORIGINS` + `SESSION_TTL_DAYS`.*
- ✅ **Phase 9 (F1)** — Web: auth screens + app shell/switchers + reports list, per the Flux design handoff (`.design-handoff/auth-ui/`). Data layer (`session.ts` + `authApi.ts`, T-1) landed first; then: Flux tokens + Plus Jakarta Sans in `styles.css` (teal `--data` family, radius 18/12/22, pill buttons) + the Flux component CSS (status chips, role badges, gradient avatars, glassy topbar, switcher pills/menus, status-rail rows, auth split layout); screens `/signup` (split brand panel, SSO "coming soon"), `/login` (inline bad-creds), `/accept?token=…` (locked email, valid/expired, requiresLogin→login handoff per D21), app shell (org+project switchers = primary nav, user menu, theme toggle), `/p/:projectId/reports` (rail rows: date block · title · author avatar · status chip · matrix-gated action pill Continue/Review/Send/View, teal "X/Y opened", filter tabs, empty states, newest-first), `/account`; `RequireAuth`/`RedirectIfAuthed` guards; legacy Review/Admin pages live inside the shell (`api.ts` now sends the session bearer). Backend gap filled: `GET /api/orgs/:orgId/projects` returns each project + the caller's role (`repo.listProjectRolesForUser`, batched). `scripts/seed-demo.mjs` seeds draft/finalized/sent(1/2-opened) demo rows for the F-phase previews. Deferred to F2+: in-app "Create organization" (no endpoint), topbar search, profile-edit endpoints, sort control. Verified: web typecheck + vite build; 127/127 server tests (3 new); full preview walkthrough (signup/login/accept valid+expired+existing-account, switchers, filters, role-gated actions as admin vs invited super, account, review-in-shell, light+dark, 375px no-overflow). *Deploy-to-dev still pending the Phase 0 dashboard steps.*
- ✅ **Phase 10 (F2)** — Web: Send modal + Delivery panel + Settings. **Send modal** (design centerpiece): roster company rows w/ whole-company checkbox (indeterminate on partial) + expandable contacts, pre-checked from the remembered distribution default (D-8, "Pre-filled from your last send"), "+ Add person" ad-hoc recipients, optional message, live count, Send disabled at 0, post-send confirmation → Delivery; opens from the reports-list Send pill (`/review/:id?send=1`) and the finalized sticky bar (which gained **Send report** + **View delivery**). **Delivery** (`/review/:id/delivery`): per-send "Sent {when} · X of Y opened" + teal progress + Resend-to-unopened; rows = avatar · name · company/email · Opened{time}/Not opened/Revoked with per-row Resend + Revoke; revoked links collect in a subsection. **Settings** (`/settings/{members,projects,stakeholders}` tabs; supers/viewers get the read-only banner): Members table (org-role select w/ **last-admin lockout**, per-project assignment chips + dialog, remove w/ org-scoped cascade, Invite modal = email + org role + project assignments → invite URL + email), Projects (create, visibility w/ explanations, member/roster counts, roster dialog attaching directory companies), Stakeholders (directory grouped by kind, expandable contacts, inline add/remove). **Backend gaps filled** (settings.ts + repo + contracts DTOs): GET/PATCH/DELETE org members, POST org projects, PATCH project visibility, GET/PUT/DELETE project members (all matrix-gated, 404-no-leak). Reports-list action now per-report (D-7: super Sends own only). Verified: 132/132 server tests (5 new settings), web typecheck + build, full preview loop (directory add → roster attach → send 3 via modal → open recorded → revoke → re-open modal pre-filled → invite w/ assignment). *Deferred: recipient-view expired-state styling (F4), account profile edit, in-modal "+ Add organization" (directory read is admin-only).*
- ✅ **Phase 11 (F3)** — Capture: login + project picker + authenticated upload, per the Flux design handoff. **Tokens/fonts:** capture `styles.css` `:root`/dark blocks moved to the Flux values (teal `--data` family, `--line-strong`, soft variants, radius 18/12, new shadows/ring) + Plus Jakarta Sans replaces Space Grotesk/IBM Plex (one family, 400–800, self-hosted/precached); PWA theme-color follows. **Login** (`LoginScreen`): mobile brand-pin header, large 16px inputs, 60px primary button, inline bad-credentials/429 errors, future-SSO row + "Coming soon" pill, "your admin sends you an invite" footer (no sign-up in capture). **Project picker** (`ProjectPickerScreen`): capture-capable projects across the account's orgs (org admin = all; member = pm/super assignments — viewers excluded per §6.1 canCapture), "Recent" highlight + "Last walk {when}" from an on-device capture history, search appears >6 projects, offline fallback to the last-fetched list, sign-out. **Data layer:** `lib/session.ts` (bearer + cached account in localStorage — offline keeps working; only a real 401 logs out), `lib/authApi.ts` (login/logout/me/listProjects), `lib/activeProject.ts` (picked project + history + cache), gates wired in `App.tsx` (onboarding → login → picker → capture) with a boot `me()` refresh; Home gains a tappable project pill. **Authenticated transfer:** the upload XHR carries the bearer (401/403 stop the retry loop — 401 clears the session, walk stays pending in IndexedDB, nothing lost); `lib/api.ts` report calls send the bearer + friendly session-expired errors; PDF export fetches with the header → object URL (a bare tab can't send a bearer); the old "share /r URL" send is now a hand-off to the web review page (`?send=1`) since /r went internal (§6.6). **Review screen:** project + preparer are read-only provenance rows ("From picker" / "From login" lock badges) + the "Changed:" note; details stamp onto the walk row from the picker + account; free-text `lib/profile.ts` deleted. Verified: capture typecheck + vite build; 132/132 server tests; live preview at 375×812 (login bad-creds + success, picker pick/re-pick/Recent, home pill, injected pending walk → authed sync → mock pipeline → report ready → in-app report, bogus-token reload → clean logout; zero horizontal overflow; both themes). *Deploy-to-dev still pending the Phase 0 dashboard steps.*
- ✅ **Phase 12 (F4)** — External recipient view shell + styled emails, per the Flux design handoff §RECIPIENT/§EMAILS (report body unchanged). **Recipient shell** (`/s/:token`, send.ts): the old one-line banner became the designed slim sticky bar — brand pin + "Daily field report — {project}" + **Download PDF** pill (`/s/:token.pdf`) + "🔒 Shared with you · read-only · link expires {date}" — injected over the hosted HTML (robust `<body[^>]*>` anchor; project name via report meta). **State pages** (`shareStatePage`): friendly full-page **expired** (amber clock tile, expiry date) and **revoked** ("This link has been turned off", red slash) states plus not-found/not-ready, each with a contact-the-sender card (initials avatar, "{sender} · {org}") and a **mailto CTA** ("Email {sender} for a new link") resolved best-effort from the send's `sentBy` + report org. **Emails** (email/templates.ts): new Flux shell — blue brand band, 600px card radius 14, one full-width CTA, private-link/expiry meta line, muted footer strip, `color-scheme:light` + explicit colors for dark-mode clients, Plus Jakarta stack; **distribution** = "Daily field report for {project}" + "{sender} shared the {long date}…", quoted italic Send-modal message with attribution, **View report** button, "private link just for you · expires {date} · no attachment" line, replies-go-to-{sender} footer (From "{sender} via FieldReport" + reply-to unchanged); **invitation** = "You've been invited to {org}", role line, invited-by strip (now carries the inviter's email), **Accept invitation** button, and the expiry note now says **14 days** (matches `INVITE_TTL_DAYS` — the design's "7 days" copy was wrong). Verified: server typecheck; 132/132 tests (send/email/invitation suites cover the states + templates); live loop on the hermetic server — real send to 3 ad-hoc recipients → normal shell renders over the capture-uploaded report + PDF pill streams `application/pdf`, revoke → revoked page, pglite-backdated expiry → expired page (all screenshot-checked at mobile width), mock distribution + invitation emails rendered + eyeballed. *Deploy-to-dev still pending the Phase 0 dashboard steps.*

- ✅ **Review fixes (Phases 9–12)** — the xhigh adversarial review of `9eb2cea..HEAD` (34 agents; 27 surviving findings, 17 confirmed, 1 refuted) + a 4-verifier adversarial pass over the fix diff itself (7 problems found → all fixed). **Server:** `/s/:token(.pdf)` now serves a branded "being updated" 503 for non-`reviewed` reports (post-send edits can't leak mid-edit/DRAFT content to recipients; status re-checked *after* `ensureArtifacts` to close the edit race); send 409s unless `processing==='ready'`; share emails attribute to the ACTUAL sender (matches reply-to); local-driver media = short-lived signed URLs (`?exp&sig`, per-boot HMAC — `<img>`/`<audio>` can't carry a bearer, photos were 401ing on local); last-admin guard is now atomic (`FOR UPDATE` tx in repo, unguarded methods deleted); `ensureProjectFromUpload` is create-only (a stale capture manifest can no longer rename a project org-wide); per-recipient `email_error` recorded + exposed as `Recipient.emailError` (a Resend rejection was silently swallowed — bit the user live on dev); `/r(.pdf)` accepts break-glass; `GET /api/reports/:id` returns per-requester `canEdit` (contracts `1.2.1`). **Web:** hosted HTML/PDF open via bearer-carrying blob URLs (were always-401 bare anchors); ReviewPage is role-aware (read-only view for viewers/non-owner supers — no more 403-autosave loop; `?send=1` gated) and trusts server `canEdit` (local org-scoped derivation misclassifies cross-org reports); `switchOrg` clears the stale project list (org-switch redirect bug); sent-then-edited reports rail as drafts again; login redirect keeps `?send=1`; SendModal roster-failure retry + whole-company defaults stored as `orgIds`; stakeholder add-contact errors surface; delivery rows show an "Email failed" chip; in-memory session fallback. **Capture:** picker retry + auto-refetch on reconnect (+ guard when no cached account); workspace state is account-bound (`ownerUserId` — shared-device 401 can't leak the previous user's project/history); walks stamp attribution ONCE (project switch can't silently re-attribute a pending walk; stamp failures retryable); hand-off "Sent" state only when a window truly opened (incl. the `noopener`-returns-null spec trap); PDF blob URLs revoked; cross-tab active-project sync; in-memory session fallback + login-busy `finally`. Verified: 141/141 server tests (11 new), all 4 workspaces typecheck+build, live preview (login → reports list → review; local-driver photos now load via signed URLs). Also: `render.yaml` trued to the live prod dashboard (sonnet-4-6 / nova-3 / LangSmith) and §17 added (Phase 13 one-app plan).

- ✅ **Phase 13a** — One app: capture merged into web (§17 architecture). `apps/web/src/capture/` hosts the ported flow; `CaptureApp` mounts at **`/capture`** OUTSIDE the shell (own install gate → login → picker → capture loop; no RequireAuth — it gates itself offline-first). **One session**: token was already the same localStorage key in both apps, so `capture/lib/session.ts` became a facade over web's `session.ts` (token) + the capture-local offline account cache; theme re-exports web's module (same key); `capture/config.ts` re-exports the web `API_BASE` and `reviewUrl()` is now the INTERNAL `/review/:id`. **Hand-off dies**: ReportScreen's Send = `useNavigate('/review/:id?send=1')` — no popup, no blocker detection, no second login (verified live: login inside /capture → deep-link to review → Send modal opens with the same session). **CSS scoping**: `postcss-prefix-selector` (web devDep) rewrites ONLY `capture.css` under `.cap` (`:root`/`html`/`body` → `.cap`; `[data-theme='dark']` → descendant form; keyframe steps untouched) — verified in the built bundle: 0 unprefixed leaks, web surfaces unpolluted. **PWA moved**: vite-plugin-pwa + registerSW now in web (manifest `start_url: '/capture'`, scope `/`, Flux theme colors; /api NetworkOnly), icons/apple-touch/meta merged into web `index.html` (viewport-fit=cover + no-zoom); web theme.ts adopted the Flux status-bar hexes. `apps/capture` is left building/deployed untouched as the legacy origin until the pilot re-installs (installed PWAs pin their origin); retire it + shrink CORS after that. Verified: web build green (tsc strict ×2 + vite + SW, 20 precache entries), full /capture flow + reload persistence (session/account-bound project) + desktop management pages at both viewports, no console errors. *13b (mobile-responsive management) next; nav affordance INTO /capture from the web UI is part of 13b.*

- ✅ **Phase 13b** — Mobile pass on the management surfaces (§17). One new `@media (max-width: 640px)` block in web `styles.css` (token-driven — both themes for free) + presentation-only markup: **touch targets** to the capture standard (≥44px: all `.btn` incl. `btn-sm`, filter tabs, switcher pills, icon/theme buttons at 44×44, avatar button padded to a 44px hit area, menu items, inputs/selects, 20px checkboxes); **switcher/user menus** render as full-width sheets anchored under the top bar (`.switcher` goes static, `.menu` spans `left/right: 10px` — a 240px absolute panel overflowed 375px), scrollable at `max-height: min(60vh, 480px)`; **modals** become safe-area-padded bottom sheets (`94dvh`, footer buttons share the row full-width, counts on their own line); **review finalize bar** = thumb bar (save indicator full line, actions two-up ~156×46, safe-area padding; inline Reviewed badge hidden — the header shows it); **delivery rows** = avatar-led grid cards (status + `deliv-actions` Resend/Revoke split the width under the name; per-send header stacks progress full-width via `.deliv-head`); **members table** collapses to cards (`.table-cards` opt-in: thead hidden, `td[data-label]::before` captions; `/admin`'s operator table wraps in `.table-scroll` sideways-scroll instead); **settings rows** stack via new `.settings-main`/`.settings-controls` anatomy (ProjectsPage restructured); plus mobile-only wrap guards (rail-meta, sel-org-name, deliv-name/org). **Nav INTO /capture** (13a follow-through): topbar camera icon-button + "Start a walk" user-menu item + the reports-list empty-state links to `/capture`. **Hardened by a 21-agent adversarial review of the diff** (3 lenses × ≤8 candidates + 1 skeptic each; 15 survived → 7 distinct): shared-class rules in the mobile block are scoped `:where(:not(.cap *))` (zero-specificity guard) so nothing leaks into `/capture` — probe-verified 44px outside `.cap`, auto inside; `.deliv-actions`/`.settings-controls` base gap = 12px matching the parent rows they replaced (desktop pixel parity; 8px only ≤640); wrap guards moved into the media block; topbar paddings/gaps tightened at 375. Verified live at 375×812 (hermetic server): reports list / review / Send sheet / delivery (desktop gap re-checked = 12px) / all three settings tabs — zero horizontal overflow, all targets ≥44px, both themes; desktop (1280) unchanged (33px pills, real table, inline rows); `/capture` install gate pixel-identical; no console errors; build green. *Trade-offs on record: at 375px the 5 fixed 44px topbar controls still ellipsize the switcher labels hard (full names one tap away in the sheet menus); the members card collapse drops table semantics for screen readers ≤640px (the standard responsive-cards trade-off — revisit if a11y becomes a pilot requirement).*

- ✅ **Phase 14a** — Email failures visible everywhere + boot/health config guards (§18). Root cause of the pilot's missing emails captured live via a probe send on dev: the Resend account has **no verified domain** (testing mode — rejects every recipient except the account owner; invites "worked" only because the pilot invited themselves). The unblock is a dashboard action (verify a domain at resend.com/domains + point `EMAIL_FROM` at it); this commit makes the failure class impossible to miss: SendModal confirmation reads `recipients[].emailError` from the 201 ("N of M emails failed" + raw provider message; title flips when nothing went out), Delivery shows the rejection text in full under the recipient (was hover-only `title` — dead on phones), resend endpoints return honest `{ok,error}`, `/healthz` += `db: postgres|pglite` / `emailFromDomain` / `emailDomainVerified` (Resend domains API at boot), and boot guards (`bootConfigErrors`): Render without `DATABASE_URL` refuses to boot (ephemeral-pglite insurance); malformed `EMAIL_FROM` fatal on Render/warn locally (`parseFromAddress`). 147/147 tests (+6). Commit `ac5a011`.
- ✅ **Phase 14b** — Stakeholders: save-once, suggest-forever (§18; pilot feedback item 4). **Server** (send.ts): on send, every ad-hoc recipient is persisted as a directory contact — an existing contact with the same normalized email is linked instead of duplicated (`findContactsByEmails`, oldest-first) — under a found-or-created **"Added from sends"** company (kind `other`); every involved company (incl. off-roster typeahead picks, which resolve org-wide) is auto-attached to the project roster (`addProjectStakeholder`, `onConflictDoNothing`); minted recipient rows carry `contactId`; the remembered distribution default is stored **enriched** (ad-hoc → contactIds, `adHoc: []` — so next open pre-checks them as roster people). **New endpoint** `GET /api/projects/:projectId/stakeholder-suggestions?q=` (requireSendCapable 404-no-leak; min 2 chars; org-wide `ilike` on name/email with LIKE-metachar escaping; cap 8; contracts += `StakeholderSuggestion`). **Web** (SendModal): debounced (250ms) typeahead under "+ Add person" — picking a roster person checks their company row; an off-roster person renders in a "From the directory" block with company chip + Remove; legacy defaults' `def.adHoc` restored in the prefill (was silently dropped); empty-state copy now says added people are saved (was pointing viewers at the admin-only Settings tab). **Hardened by a 34-agent adversarial review of the diff** (5 finders + per-candidate verifiers): the modal's prefill is now apply-once and MERGES into user picks (the roster-error Retry used to wholesale-replace `selected`/`adHoc`, silently dropping people picked while the roster was down — extras that turn out to be roster people also get pruned into their checkbox rows); the **catch-all is never stored as an `orgIds` default** (a whole-company pick of "Added from sends" is materialized to explicit contactIds — else the remembered default would silently grow with strangers typed ad-hoc on *other* projects); the whole persist/attach block is **best-effort** (`try/catch` — a directory hiccup can't 500 a send; un-persisted people ride the default as raw `adHoc` again); duplicated `?q=&q=` (array) coerced instead of 500; `SendSelection.adHoc` tightened to the directory DTO's limits (`.trim().min(1).max(200)` name, `.max(254)` email, `.max(200)` array — these rows are now permanent directory writes); add-person dedupes typed emails against picked people; Cancel clears the form. *Accepted by design (on record): org-wide suggestion visibility for send-capable roles (the asked-for behavior — name/email/company only); supers' sends auto-attaching involved companies to the roster (that IS the feature); the find-or-create race under concurrent first sends (cosmetic duplicate catch-all; oldest deterministically wins thereafter — candidate hardening: partial unique index).* 157/157 tests (+10 total: send persistence/dedupe/attach/enriched-default/catch-all-default/bookkeeping-failure/validation + endpoint authz/tenancy/LIKE-escape/array-q). Verified live end-to-end (hermetic server + preview): type→suggest→pick (roster + off-roster), send 3, roster gains both companies, reopen pre-checks all three from the enriched default; catch-all exclusion re-checked live post-fix.

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
  2. **R2:** create bucket `fieldreport-dev` + API token → endpoint + keys.
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

## 17. Phase 13 — One app: unify capture + web (user directive 2026-07-08)

Directive: capture and web must be ONE app. Report *creation* stays mobile-only
(the capture flow), but view / edit / send / resend / delivery / recipients /
settings must all work from the phone too. Today's split forces a second origin,
a second login, and a lossy `?send=1` hand-off — that friction is the bug.

**Architecture (decided): unify on `apps/web` as the host.**
- Why web as base: it already has the app shell — react-router routes, guards,
  workspace/org context, 14 pages (~3.6k lines) — which is the expensive thing to
  re-host. Capture's screens are self-contained full-screen components (no router)
  that mount cleanly anywhere; its Dexie repo + sync engine are self-contained
  modules that move without surgery.
- PWA: move `vite-plugin-pwa` config + registration from capture into web. The
  install gate (durable iOS storage) wraps ONLY the `/capture` flow — management
  pages must work in a plain mobile browser tab.
- Session: one origin = one login. Keep web's session.ts as the base; port
  capture's offline account cache (cached PublicUser; only a real 401 logs out)
  into it so the installed app still boots offline.
- Capture flow mounts at `/capture` (login → project gate → home → camera/voice →
  review/sync). ReportScreen's "Send" becomes internal navigation to
  `/review/:id?send=1` — the cross-origin hand-off (and its login wall) dies.
- 13a (merge): port capture modules (repo.ts, sync.ts, lib/*, screens) into
  apps/web; unify api/auth clients; move PWA plumbing; route-gate install; retire
  apps/capture from the build; capture-dev URL becomes a redirect. Server: CORS
  list shrinks to one origin per env.
- 13b (mobile pass): responsive audit of reports list / review / send modal /
  delivery / settings on a 375px viewport — this is the "manage from the phone"
  half of the directive. Large touch targets per capture's standards.
- Deploy: one Vercel project per env afterward (`fieldreport-web-dev` hosts the
  unified app; later prod likewise). Keep the old capture project only as a
  redirect shell until the pilot's home-screen icons are re-pointed (installed
  PWAs keep their origin — users must re-install from the new origin once).

Status: ✅ 13a done · ✅ 13b done (see §14.4). Remaining: post-pilot-reinstall cleanup (retire apps/capture deploy, redirect capture-dev, shrink CORS) — folded into §18 Phase 15c.

## 18. Phases 14–16 — Pilot feedback round 1 (user field test 2026-07-08, plan drafted 2026-07-09)

Eight feedback items investigated (7-agent workflow + 2 live probes + screenshots).
Findings on record: dev DB is PERSISTENT (marker account survived a redeploy — the
"reports disappear" report closed as legacy-app local-state confusion, user confirmed
data intact); the failed share email's provider rejection IS recorded per-recipient
(`email_error`, screenshot shows the chip) but is hover-only — unreadable on mobile;
invitation emails DELIVER while share emails FAIL from the same verified EMAIL_FROM —
the only code deltas are the share path's display-name rewrite
(`fromWithDisplayName`, email/types.ts:31 / resend.ts:19) and its `replyTo`; the
user tested from the LEGACY installed PWA (screenshot shows the iOS in-app browser
sheet = window.open cross-origin hand-off); stakeholders confusion = two-tier
directory/roster model + Send-modal empty-state copy pointing at the wrong screen +
prefill dropping remembered `def.adHoc`; topbar unreadable at 375px = five fixed
controls starving two switcher labels (~43px each); PDF share = anonymous `blob:`
tab, "Unknown.pdf", dead link (screenshot), no `navigator.share` anywhere, server
Content-Disposition uses the report UUID; Watson = config.ts fallbacks + boot seed
re-clobbering org/project names EVERY boot + render*.yaml values + pilot glossary +
SignupPage placeholder ("Watson Builders (dev)" on dev is the dashboard env value).

Decisions approved by the user (2026-07-09): combined org/project switcher pill with
theme toggle moving into the avatar menu; camera button stays in the bar; PDF button
opens the native share sheet directly; Watson eliminated from all defaults.

### Phase 14 — Quick wins (each sub-phase = one commit, independently verifiable)

**14a Email: make failures visible, then fix the share-path delta.**
- SendModal post-send confirmation reads `recipients[].emailError` from the 201:
  "Sent to N — M emails failed" + the provider message + link to Delivery (today a
  100%-failed send shows pure success).
- Delivery panel: email-failed reason inline/tappable (currently `title` hover-only —
  dead on touch). Resend endpoint returns the real outcome (`{ok:false,error}`)
  instead of unconditional ok, so DeliveryPage can toast it.
- Boot/config: strict EMAIL_FROM format parse (warn on dev, fail on prod); /healthz
  gains `emailFrom` domain + `emailDomainVerified` via Resend's domains API (cached,
  'unknown' on API failure) and `db: postgres|pglite` + a Render-without-DATABASE_URL
  boot guard (item-1 insurance, same commit family).
- Root-cause fix: read the recorded rejection (visible after the chip fix, or via
  one Resend click), then fix the delta it names — candidates are the
  `fromWithDisplayName` rewrite (only applied on shares) and share `replyTo`; add a
  unit matrix for EMAIL_FROM forms (bare / display-name / whitespace) × invite/share.
- Tests: from-construction units; emailError surfacing integration.

**14b Stakeholders: save-once, suggest-forever.**
- Server, on send: persist ad-hoc recipients as directory contacts (dedupe by
  normalized email per org; contacts win over typed duplicates — the rule send.ts
  already applies), under a found-or-created per-org "Added from sends" org (kind
  'other'; no schema migration), auto-attach involved companies to the project
  roster (`onConflictDoNothing`), stamp `contactId` on minted recipient rows.
- New send-capable endpoint `GET /api/projects/:projectId/stakeholder-suggestions?q=`
  (min 2 chars, capped, org-scoped; requireSendCapable — the org directory read
  stays admin-only).
- SendModal: typeahead on "+ Add person" from that endpoint; restore `def.adHoc` in
  the prefill (bug — server remembers it, client drops it); empty-state copy stops
  pointing at Settings → Stakeholders and says added people are saved to the project.
- Tests: repo dedupe/attach; endpoint authz (pm/super yes, viewer no, cross-org 404).

**14c Topbar: combined context pill (management bar; commit A of unification).**
- One switcher pill: project name 13.5px/700 primary line, org name 11px muted below;
  one menu with Organizations + Projects sections (reuse Dropdown). Theme toggle
  becomes an avatar-menu item. Bar = pin · context pill · camera · avatar →
  ~187px label at 375px (vs ~43px today). Drop sep-dot + two-pill flex rules.

**14d PDF: share the file, name the file.**
- Capture ReportScreen → "Share PDF": fetch bytes → `File` named
  "<Project> – <YYYY-MM-DD>.pdf" (sanitized) → `navigator.share({files})` behind
  `canShare` detect; fallback = named `<a download>` (desktop) / open tab.
- Server: Content-Disposition filename "<Project> – <date>.pdf" (+ RFC 5987
  filename*) on /r/:id.pdf and /s/:token.pdf; `download` attr on the recipient
  shell's PDF anchor. Web ReviewPage gets `downloadAuthedArtifact(url, filename)`.
- Legacy apps/capture NOT mirrored — 15c retires it instead.

**14e Watson eradication.**
- Gate `seedPilot`: skip org/project upserts unless the PILOT_* env is explicitly
  set; change name upserts to create-if-missing (stop the every-boot clobber so
  renames stick). Neutral fallbacks in config.ts ('My Organization'/'Pilot Project');
  empty the Watson nouns from PILOT_GLOSSARY; scrub render.yaml:50,
  render.dev.yaml:75/77, both .env examples, SignupPage placeholder; update
  seed-pilot tests.
- ORDERING: the user renames via dashboard env (PILOT_ORG_NAME/PILOT_PROJECT_NAME →
  real names, needs their chosen names at execution) and boots ONCE under current
  clobber semantics so org_pilot_dev/pilot-project rename in place keeping PH11 +
  reports; THEN the declobber deploys.

**14f Dev hygiene.** Delete the persistence-probe account/org from the dev DB
(created 2026-07-09 for the item-1 test: persistence-probe-20260709@fieldreport.test).

### Phase 15 — Seamless one-app (structural)

- **15a** Workspace boot caching: cache/hoist the /me + projects fetch (session-store
  keyed) so entering Shell from /capture is spinner-free; adopt capture's tolerant
  cached-account boot (never hard-block on a network blip).
- **15b** Exit nav from capture: "View reports" affordance in capture Home header
  (+ ReportScreen header); install-gate gets an escape link back to the app (gate
  itself stays — capture creation remains installed-mobile-only by design).
- **15c** Legacy retirement: final apps/capture build = "Move to the new app" screen
  linking to the web origin's /capture; user re-installs (walk data note: time it
  when no walks are pending sync); then capture-dev becomes a redirect, CORS shrinks
  to one origin per env, apps/capture leaves the build.
- **15d** Shared <TopBar> primitive (commit B): props-only glassy bar (own uniquely
  prefixed classes so it renders identically inside `.cap`), adopted by the five
  capture screens — one brand mark, one border, 44px controls, back/title slots.
  Kills the 7-implementations drift behind #5.

### Phase 16 — Bottom-tab shell (the full "one seamless SaaS app")

Mobile bottom tab bar (Capture | Reports | Settings) with capture as a tab; inner
capture screens (camera, sync) stay full-screen. Prereq: WorkspaceProvider
offline-tolerant (15a groundwork). Scope it AFTER 14/15 land and the pilot re-tests —
it rebuilds navigation and should absorb that feedback.

Execution-time inputs still needed from the user: the real org + project names for
14e's dashboard rename; and (fast path for 14a) the email-failed chip's hover text
read from a desktop browser, else the chip fix surfaces it on mobile first.

Status: 🟡 in progress — ✅ 14a (`ac5a011`) · ✅ 14b · next 14c → 14f, then Phase 15.
User actions still owed: verify a domain at resend.com/domains + set `EMAIL_FROM` on it
(the actual email unblock); real org/project names for 14e's dashboard rename.

# Claude Design Brief — FieldReport: Accounts, Teams & Report Distribution

> Hand this whole document to Claude Design. It should produce a **hi-fi UI handoff** (screens + flows + spec) for the features below, **matching FieldReport's existing design system exactly** (tokens in §3). Deliver in the same format as the prior "Daily Field Report" handoff (§12).

---

## 1. Overview

**FieldReport** is an offline-first construction field-reporting product. A superintendent walks a jobsite on their phone (the **capture** PWA), recording voice notes + photos per observation. The system transcribes, uses AI to synthesize a polished **daily field report**, and renders it to a hosted web page + PDF. A **web app** (desktop) is where reports are reviewed, finalized, and managed.

Today it's a single-project pilot with no accounts. We're adding the three things that make it a real product. **Design all the screens and flows for:**

1. **Accounts & teams** — sign up, log in, invite teammates, multiple organizations per person, roles.
2. **Project-scoped workspace** — an org/project switcher, a reports list, settings.
3. **Report distribution** — send a finalized report to outside stakeholders (owner, architect, engineer…) via per-person expiring links, and see who opened it.

There are **three surfaces**: the **web app** (desktop-first, most of the work), the **capture PWA** (mobile, two small additions), and the **external recipient view** (the hosted report page an outsider opens). All three share one design system (§3).

---

## 2. Who uses it & the core concepts

- **Org** — a generic tenant. Could be a GC, a one-person operation, or an owner/developer. A person can belong to **several orgs** and switch between them.
- **Roles** — org-level **Admin**; per-project **PM**, **Super(intendent)**, **Viewer**. (GC/owner outsiders are *not* roles — they're external link recipients.)
- **Project visibility** — each project is either **Org-visible** (any org member can view finalized reports) or **Assigned-only** (only people added to the project). Admins always see everything.
- **Stakeholder directory** — an org keeps a directory of the **outside companies** it works with (owner, architect, structural, MEP, lender…), each with **contacts** (name + email). Projects pull in the relevant ones. This powers "Send."
- **Report lifecycle** — `Draft` → `Ready for review` → `Finalized` → `Sent` (with open counts). The creator self-finalizes; a PM/Admin can finalize anyone's.
- **Send** — pick stakeholder companies (one tap = everyone on that team) or specific people; the system emails each a **private, expiring (30-day), revocable link** to the hosted report. No PDF attachment — recipients view in-browser and can Download PDF. We record **sent + who-opened**.

### Permission cues the UI must reflect

| Action | Admin | PM | Super | Viewer |
|---|:--:|:--:|:--:|:--:|
| Capture / create report | ✓ | ✓ | ✓ | — |
| Edit/finalize **any** report on project | ✓ | ✓ | own only | — |
| Send / revoke / resend | ✓ | ✓ | ✓ | — |
| View finalized reports | ✓ | ✓ | ✓ | ✓ |
| Manage members / visibility / roster | ✓ | ✓ | — | — |
| Manage org + stakeholder directory | ✓ | — | — | — |

Design empty/disabled states so a Viewer doesn't see a Send button, a Super doesn't see org settings, etc.

---

## 3. Design system to MATCH (this is mandatory — do not invent a new look)

The capture and web apps already share one system (`apps/web/src/styles.css`, `apps/capture/src/styles.css`). New screens must look like they were always there. Use CSS variables, not hardcoded hex.

### Brand
- **Mark**: a two-tone **waypoint-pin** SVG (blue body, light interior strokes) — *not* a square "FR" badge. Wordmark "**FieldReport**" set in Space Grotesk, 18px, 700.
- Blue-forward, calm, professional. Construction-credible but clean (think Linear/Stripe restraint, not a heavy "enterprise" look).

### Color tokens (light / dark — full dark mode required)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#eef1f5` | `#0b0e13` | page background |
| `--surface` | `#ffffff` | `#141a22` | cards, inputs, surfaces |
| `--surface-2` | `#f5f7fa` | `#1a212b` | hover, secondary fills, table zebra |
| `--fg` | `#0e141b` | `#e8ecf2` | primary text |
| `--muted` | `#5b6675` | `#8a95a6` | secondary text |
| `--line` | `#e1e6ec` | `#232c39` | borders/dividers |
| `--line-strong` | `#cfd6df` | `#2c3848` | input borders, focus |
| `--primary` | `#2563eb` | `#4c8dff` | primary actions, links, brand |
| `--primary-ink` | `#ffffff` | `#04101f` | text on primary |
| `--primary-soft` | `#e7eefd` | `#11223b` | chips, badges, table headers |
| `--accent` | `#f59e0b` | `#fbbf24` | **draft/warning only** (amber) |
| `--accent-soft` / `--accent-ink` | `#fdf0d8` / `#7a4d05` | `#2a2410` / `#fbbf24` | draft badge |
| `--danger` (+`-soft`) | `#e0492f` / `#fbeae8` | `#ff6151` / `#2c1714` | errors, destructive, revoke |
| `--ok` (+`-soft`) | `#0ea45a` / `#e3f5ec` | `#34d399` / `#0f2a20` | success, "opened" |
| `--radius` / `--radius-sm` | `13px` / `9px` | same | cards / inputs+buttons |
| `--shadow` | `0 1px 2px rgba(14,20,27,.06), 0 12px 26px -16px rgba(14,20,27,.18)` | dark variant | card elevation |

> Color discipline: blue = primary/actions; amber = **draft/warning only**; green = success/opened; red = error/destructive. Don't introduce new hues.

### Typography
- Body: **IBM Plex Sans** (400/500/600/700), 14–15px, line-height ~1.5.
- Display/headings & big numbers: **Space Grotesk** (500/600/700). h1 26px, h2 18px.
- Eyebrow labels: Space Grotesk, uppercase, 12px, 700, letter-spacing 0.08em, color `--primary`.
- Mono: system mono (for tokens, emails, IDs).

### Components (reuse these patterns)
- **Buttons**: radius 9px, weight 700. Primary = `--primary` bg / `--primary-ink` text. Secondary = `--surface` bg, `--primary` text, 1px `--line-strong` border (hover → border `--primary`). Large variant 13×22px / 16px for hero actions (e.g. Finalize, Send).
- **Inputs**: 100% width, 15px, 1.5px `--line-strong` border, radius 9px, focus → border `--primary` + `0 0 0 4px var(--ring)`.
- **Cards**: `--surface`, 1px `--line`, radius 13px, `--shadow`, ~20px padding; stack with 16px gaps.
- **Badges/status chips**: pill, 12px, 700, uppercase. Draft = amber-soft; Reviewed/Finalized = primary-soft (or success); Processing = `--surface-2`/`--muted`; Sent = primary-soft with "opened X/Y".
- **Trade/area chips**: primary-soft, 12px, 600, radius 9px, small icon.
- **Tables** (admin/list style): header `--primary-soft` text `--primary`, uppercase 12px; rows hover `--surface-2`; 1px `--line` dividers.
- **Layout**: desktop page max-width ~1100px (narrow 860px for forms/review); **sticky top bar**, no left sidebar (keep the existing topbar nav model); 28px vertical page padding.
- **Sticky action bar** at viewport bottom for primary commit actions (matches the existing Finalize bar).

### Existing screens to echo (for consistency)
Match the look of the current `ReviewPage` (review/edit), `AdminListPage` (table), and `AdminDetailPage` (raw-vs-polished side-by-side) and the capture app's mobile cards/bottom-bar.

---

## 4. WEB APP — screens to design (desktop-first, light+dark)

For each: design the screen, its empty/loading/error states, and note which roles see it.

### 4.1 Sign up (creates an org)
First-run. Fields: name, work email, password, **organization name**. Submitting creates the org and makes you Admin. Friendly first-run framing ("Create your FieldReport workspace"). Link to log in.

### 4.2 Log in
Email + password. "Stay logged in" is implicit (long-lived). Error state for bad credentials. Link to sign up. Leave space for future "Continue with Google/Microsoft/Apple" SSO buttons (design them as a future-ready row, visually de-emphasized or labeled "coming soon" — your call).

### 4.3 Accept invitation
Reached from an emailed link (`/accept?token=…`). Shows "You've been invited to **{Org}** as **{role}**" + the invited email (read-only); user sets **name + password**, then lands in the app. Handle an expired/invalid invite state.

### 4.4 App shell — top bar & switchers (the frame for everything below)
- Left: brand mark + **Org switcher** (dropdown; lists the user's orgs, check current, "Create org"); then **Project switcher** (dropdown of projects in the current org the user can access; search; current checked).
- Right: search, **user menu** (name/avatar → account, sign out).
- The switchers are the primary navigation. Design the dropdown states (many orgs, single org, many projects, search).

### 4.5 Reports list (home)
Scoped to the current project (or "all my projects" view). Rows: date block, title, author, **status chip** (Draft / Ready for review / Finalized / Sent · opened X/Y), and a context action (Continue / Review / **Send** / View). Include: header with project name + count, filter/sort affordance, and a clear **empty state** ("No reports yet — start a walk on your phone"). (Reference the mocked version we explored, but as polished hi-fi.)

### 4.6 Report — review & edit (mostly exists; restyle + extend)
The editable draft: summary + per-observation cards (description, trade, area), autosave, live processing status, **Finalize** in the sticky bar. **Add**: once finalized, a **Send** button and a **Delivery** tab/panel (4.8). Show the status badge + (if sent) the open summary. Keep it consistent with today's `ReviewPage`.

### 4.7 Send / distribution modal ★ (the centerpiece — design richly)
Triggered by Send on a finalized report. Contents:
- Header: "Send report" + report title/date. Info line: "Each person gets a private link · expires in 30 days · revoke anytime." A **From preview**: "From: Jake Romero via FieldReport · replies go to Jake."
- **Recipients**: the project's **stakeholder roster** as selectable **company rows** — checkbox (whole company) + company name + kind (Owner/Architect/…) + "N people"; expandable to show individual **contacts** with their own checkboxes + email; **"+ Add person"** inside a company; **"+ Add organization"** at the bottom (attach from the org directory or create new inline).
- **Pre-filled from last send**: the previously-used selection is pre-checked, with a subtle "Pre-filled from your last send" note.
- Footer: "N people selected" + Cancel / **Send report**.
- States: nothing selected (Send disabled), an empty roster (prompt to add stakeholders), and a post-send confirmation.

### 4.8 Delivery / audit panel
On a sent report (tab or right rail). Header: "Sent {date} · X of Y opened." Per-recipient rows: avatar/initials, name, company·role, and status — **Opened {time}** (green, eye-check icon) or **Not opened** (muted, clock) — with per-row **Resend** and **Revoke** actions. Design the "link revoked" and "link expired" recipient states too.

### 4.9 Settings — Members & roles (Admin/PM)
Table of org members: name, email, org role (Admin/Member), and per-project assignments (project + role chips). Actions: **Invite member** (email + org role + assign to projects with a role), edit a member's roles, remove. Invite flow modal.

### 4.10 Settings — Projects (Admin)
List/create projects. Per-project settings: name, **visibility toggle** (Org-visible vs Assigned-only, with a one-line explanation of each), member assignment, and the project's **stakeholder roster** (which directory companies are on this project).

### 4.11 Settings — Stakeholder directory (Admin)
The org-level address book that powers Send. Companies grouped by kind (Owner, Architect, Engineer, GC, Consultant, Lender, Sub, Other), each expandable to **contacts** (name, email, title). CRUD: add/edit/remove company + contacts. This is the one screen with real setup density — make adding companies/contacts fast (inline add, keyboard-friendly).

### 4.12 Account / profile
Name, email, password change, sign out, list of orgs you belong to. (Light.)

---

## 5. CAPTURE PWA — screens to design (mobile, existing 4-screen app)

The capture app already has Home / Capture / Review / Report screens in the shared design system. Add:

### 5.1 Log in (mobile)
Email + password, full-width, large touch targets, safe-area aware, matches the capture app's existing button/input styles (58–64px tall buttons, 13px/9px radii). Same future-SSO consideration.

### 5.2 Project picker
After login (and accessible from Home), the super chooses **which assigned project** they're walking — a simple, tappable list of their projects (name + last-activity), search if many, and that's it. This **replaces** today's free-text "project name" entry on the Review screen. The preparer name now comes from the logged-in account (no longer typed). Note this change on the Review screen (project + preparer become read-only, sourced from account + picker).

---

## 6. EXTERNAL RECIPIENT VIEW — the hosted report page (account-less)

What an outside stakeholder sees when they open their emailed link (`/s/:token`). It renders the existing **Daily Field Report** (already designed — don't redesign the report body) but needs a **shell/header** around it:
- A slim top bar: brand mark + "Daily field report — {project}", a **Download PDF** button, and a quiet line: "Shared with you · read-only · link expires {date}."
- States to design: normal, **link expired**, and **link revoked** (friendly pages: "This link has expired / been turned off — contact {sender} for an updated copy"). No login, no app chrome, mobile-friendly (recipients often open on a phone).

---

## 7. The distribution email

Design the **email** the recipient receives (HTML + a plain-text fallback note):
- From: "Jake Romero via FieldReport"; reply-to the super.
- Subject e.g. "Daily field report — Watson Island — Jun 28".
- Body: brief line ("Jake Romero shared the {date} daily report for {project}."), the optional custom message, and **one clear primary button → "View report."** No attachment. On-brand (blue, IBM Plex), works in dark mode email clients.
- Also design the **invitation email** (you've been invited to {Org} → "Accept invitation" button).

---

## 8. States & edge cases to cover across screens

Empty (no reports / no members / no stakeholders / no projects), loading/skeleton, error/offline, processing (report still transcribing/synthesizing), permission-limited (Viewer/Super reduced UI), long content (many orgs/projects/recipients), expired & revoked links, and **dark mode for every screen**.

---

## 9. Data model (bind screens to these shapes)

```ts
type Org = { id: string; name: string };
type User = { id: string; email: string; name?: string };
type OrgRole = 'admin' | 'member';
type ProjectRole = 'pm' | 'super' | 'viewer';
type ProjectVisibility = 'org' | 'assigned';

type Project = { id: string; orgId: string; name: string; visibility: ProjectVisibility };
type ProjectMember = { user: User; role: ProjectRole };

type StakeholderKind = 'owner'|'architect'|'engineer'|'gc'|'consultant'|'lender'|'sub'|'other';
type StakeholderContact = { id: string; name: string; email: string; title?: string };
type StakeholderOrg = { id: string; name: string; kind: StakeholderKind; contacts: StakeholderContact[] };

type ReportStatus = 'draft' | 'ready' | 'finalized' | 'sent';
type ReportRow = { id: string; date: string; title: string; author: User; status: ReportStatus; obsCount: number; opened?: { count: number; total: number } };

type Recipient = { id: string; name: string; email: string; org?: string; sentAt: string; firstOpenedAt?: string; openCount: number; revokedAt?: string };
type ReportSend = { id: string; sentBy: User; sentAt: string; recipients: Recipient[] };
```

---

## 10. Sample content (use this so screens look real)

- **Org**: "Watson Builders" (a GC). Current user: **Jake Romero** (Admin + Super on Watson Island).
- **Projects**: "Watson Island" (Assigned-only), "Harbor Point Phase 2" (Org-visible).
- **Members**: Jake Romero (Admin), Dana Cole (Super on both), Priya Shah (PM, Watson Island), Marcus Lee (Viewer).
- **Stakeholder directory**: Owner — *ACME Development* (Rachel Adler, Tom Reyes); Architect — *Foster + Partners* (Jane Okafor, Marcus Lee, Priya Nair); Structural — *Thornton Tomasetti* (Sam Iyer); Lender — *Meridian Capital* (one contact).
- **Reports** (Watson Island): "Framing inspection — levels 8–10" (Jun 28, Sent · opened 2/4), "MEP rough-in — level 8" (Jun 27, Finalized), "Concrete pour — podium deck" (Jun 27, Dana Cole, Ready for review), "Site logistics + safety walk" (Jun 26, Draft).
- **A sent report's recipients**: Jane Okafor (opened 5:40 PM), Marcus Lee (opened 6:02 PM), Rachel Adler (not opened), Tom Reyes (not opened).

---

## 11. Out of scope (don't design)

- The Daily Field Report body itself (already designed/built — only the recipient shell around it, §6).
- SSO provider screens (leave room for buttons; don't build the flows).
- Billing/subscription screens.
- The capture observation/voice flow (unchanged).
- Any "ask about this report" / chat — future.

---

## 12. Deliverables (match the prior handoff format)

Produce a zip like the previous "Daily Field Report" handoff:
1. **README.md** — the hi-fi spec: overview, the design system used (confirm tokens from §3), then **one section per screen** (purpose, layout, components, states, which roles), the data model, sample content, and an interactions/notes section. Self-contained enough to implement from alone.
2. **One `.dc.html` (or HTML/CSS) reference per screen / state** listed in §4–§7 — real, hi-fi, in the FieldReport tokens, light + dark where feasible. Group logically (auth, shell, list, send, delivery, settings, capture, recipient, emails).
3. **Preview images** (PNG) of the key screens.
4. A short **components** file/section documenting the reusable pieces (switchers, role badges, status chips, the company/contact selector, recipient row, avatars).

Keep everything **token-driven and theme-able** (the implementation will map your CSS to the existing `--variables`). Fidelity: **hi-fi**. We'll drop these into `apps/web` (and two screens into `apps/capture`) so structure them to translate to React + the existing `styles.css`.

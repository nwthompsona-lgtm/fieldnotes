/**
 * FieldReport — FROZEN DATA CONTRACTS (spec §5).
 *
 * This file is the single source of truth for every shape that crosses a module
 * boundary: the capture client <-> server upload seam, the processing pipeline,
 * and the report/admin views. Zod schemas are authoritative; TypeScript types are
 * inferred from them so runtime validation and compile-time types never drift.
 *
 * DO NOT change a shape here without (a) bumping CONTRACTS_VERSION and (b) logging
 * the change in DECISIONS.md. Every other module imports from `@fieldreport/contracts`.
 */
import { z } from 'zod';

/** Bump on any breaking change to the shapes below. The client stamps this into
 *  every upload manifest so the server can reject incompatible bundles. */
export const CONTRACTS_VERSION = '1.2.0';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const Iso8601 = z.string().datetime({ offset: true });

/** Stable client-generated id (uuid v4). The client mints ids offline so an
 *  observation/photo can be referenced before the server has ever seen it. */
export const ClientId = z.string().min(8).max(64);

export const ReportStatus = z.enum(['draft', 'reviewed']);
export type ReportStatus = z.infer<typeof ReportStatus>;

/** Where a bundle is in the server-side processing pipeline. Surfaced to the
 *  review/admin UIs so a super never edits a half-synthesized report. */
export const ProcessingStatus = z.enum([
  'uploaded', // bundle received, media in object storage, rows persisted
  'transcribing', // STT in flight
  'synthesizing', // LLM synthesis in flight
  'rendering', // HTML/PDF render in flight
  'ready', // report draftable/reviewable
  'failed', // see processingError
]);
export type ProcessingStatus = z.infer<typeof ProcessingStatus>;

// Roles & tenancy enums (v1.2.0, auth plan §2 / D-1..D-4).

/** Org-level role: admins manage the org, members just belong (D-3). */
export const OrgRole = z.enum(['admin', 'member']);
export type OrgRole = z.infer<typeof OrgRole>;

/** Per-project role (D-3). */
export const ProjectRole = z.enum(['pm', 'super', 'viewer']);
export type ProjectRole = z.infer<typeof ProjectRole>;

/** Who can view a project's finalized reports (D-4): whole org vs assigned members. */
export const ProjectVisibility = z.enum(['org', 'assigned']);
export type ProjectVisibility = z.infer<typeof ProjectVisibility>;

/** What kind of outside company a stakeholder org is (D-8). */
export const StakeholderKind = z.enum([
  'owner',
  'architect',
  'engineer',
  'gc',
  'consultant',
  'lender',
  'sub',
  'other',
]);
export type StakeholderKind = z.infer<typeof StakeholderKind>;

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export const Photo = z.object({
  id: ClientId,
  /** Storage key (server-assigned) OR object URL. Empty string client-side until
   *  uploaded; the client carries the actual bytes in IndexedDB keyed by `id`. */
  blobRef: z.string().default(''),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Bytes of the compressed image as stored. Informational. */
  byteSize: z.number().int().nonnegative().optional(),
});
export type Photo = z.infer<typeof Photo>;

/**
 * Markup is a SEPARATE LAYER (spec §5, §9) — never flattened onto the photo.
 * Stored as either vector strokes or a transparent PNG overlay keyed to a photo.
 * Markup itself is deferred (§12) but the shape is frozen now so adding the
 * one-tool pen later is an increment, not a refactor.
 */
export const Annotation = z.object({
  photoId: ClientId,
  /** Freehand vector strokes: array of polylines in normalized [0..1] coords. */
  strokes: z
    .array(z.array(z.object({ x: z.number(), y: z.number() })))
    .optional(),
  /** OR a pre-rasterized transparent overlay (storage key / object URL). */
  overlayBlobRef: z.string().optional(),
});
export type Annotation = z.infer<typeof Annotation>;

// ---------------------------------------------------------------------------
// Observation (one photo-set + one voice note)
// ---------------------------------------------------------------------------

export const Observation = z.object({
  id: ClientId,
  /** Sequence within the walk; assigned at capture time, preserved end-to-end. */
  order: z.number().int().nonnegative(),
  createdAt: Iso8601,
  photos: z.array(Photo).min(1),
  annotations: z.array(Annotation).optional(),
  /** Storage key for the voice note (server-side). */
  audioRef: z.string().default(''),
  /** Filled server-side by transcription. */
  transcript: z.string().optional(),
  /** Filled by synthesis (the IP). */
  cleanedDescription: z.string().optional(),
  /** Optional, synthesis-inferred. */
  trade: z.string().optional(),
  /** Optional, synthesis-inferred. */
  area: z.string().optional(),
});
export type Observation = z.infer<typeof Observation>;

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export const Report = z.object({
  id: z.string(),
  projectId: z.string(),
  /** Human-readable project label (resolved from the Project row) for display. */
  projectName: z.string().optional(),
  /** Calendar date of the walk (YYYY-MM-DD). */
  date: z.string(),
  superName: z.string(),
  /** Synthesis-generated daily summary paragraph (top of report). */
  summary: z.string().default(''),
  observations: z.array(Observation),
  status: ReportStatus.default('draft'),
  processing: ProcessingStatus.default('uploaded'),
  processingError: z.string().optional(),
  htmlUrl: z.string().optional(),
  pdfUrl: z.string().optional(),
  /** Author's user id (v1.2.0, auth plan §1.3). Optional: pre-auth reports lack it
   *  until the Phase 4 backfill; `superName` stays the display string. */
  createdBy: z.string().optional(),
  createdAt: Iso8601.optional(),
  updatedAt: Iso8601.optional(),
});
export type Report = z.infer<typeof Report>;

// ---------------------------------------------------------------------------
// Project (+ the two context-injection lexicons, spec §8)
// ---------------------------------------------------------------------------

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  superName: z.string(),
  /** Per-project proper nouns — where almost all STT accuracy gain lives (§8b).
   *  e.g. ["Watson Island", "JMA", "Najib", "Lighthouse"]. */
  glossary: z.array(z.string()).default([]),
  /** Reference to the reusable base construction lexicon (§8a). */
  baseLexiconRef: z.string().default('base-construction-v1'),
  /** Owning org (v1.2.0, auth plan §1.3). Optional: pre-auth rows lack it until the
   *  Phase 4 backfill adopts them. */
  orgId: z.string().optional(),
  /** Per-project visibility (D-4). Optional in the contract so pre-1.2.0 producers stay
   *  valid; the DB column defaults to 'assigned', so absent = 'assigned'. */
  visibility: ProjectVisibility.optional(),
});
export type Project = z.infer<typeof Project>;

// ---------------------------------------------------------------------------
// Upload seam (capture client -> server)
// ---------------------------------------------------------------------------

/**
 * The manifest is sent as a single JSON part of a multipart upload; the photo
 * and audio bytes are sent as additional parts whose field names are the client
 * ids: each photo under a field named `photo.id`, each observation's audio under
 * `audioFieldFor(observation.id)` (= `audio:<id>`). The server resolves bytes -> storage
 * keys and fills blobRef/audioRef. This keeps the phone's job to: capture +
 * durable local storage + upload (spec §3).
 */
export const UploadObservation = z.object({
  id: ClientId,
  order: z.number().int().nonnegative(),
  createdAt: Iso8601,
  photos: z.array(
    z.object({
      id: ClientId,
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      byteSize: z.number().int().nonnegative().optional(),
    }),
  ).min(1),
  annotations: z.array(Annotation).optional(),
  /** Multipart field name carrying this observation's audio bytes. */
  audioField: z.string(),
  /** Audio mime as recorded by the device (varies: iOS=mp4/aac, others=webm/opus). */
  audioMime: z.string().default('audio/webm'),
});
export type UploadObservation = z.infer<typeof UploadObservation>;

export const UploadManifest = z.object({
  contractsVersion: z.string(),
  projectId: z.string(),
  /** Human-readable project label the user typed (e.g. "Tower B — Level 4"). Optional
   *  for back-compat with v1.0.0 clients; when present the server creates/updates the
   *  Project row (so reports attribute to the right project and its glossary accrues). */
  projectName: z.string().optional(),
  /** Name of whoever prepared the report (super, foreman, PM, owner's rep, …). */
  superName: z.string(),
  /** Walk date (YYYY-MM-DD), device-local. */
  date: z.string(),
  /** Idempotency key for the whole walk so a retried upload never double-creates. */
  walkId: ClientId,
  observations: z.array(UploadObservation),
  /** Device/diagnostic breadcrumbs — invaluable for debugging on-device failures. */
  client: z
    .object({
      ua: z.string().optional(),
      installed: z.boolean().optional(), // running as installed PWA?
      tz: z.string().optional(),
    })
    .optional(),
});
export type UploadManifest = z.infer<typeof UploadManifest>;

/** Server's response to a completed upload. */
export const UploadResult = z.object({
  reportId: z.string(),
  walkId: ClientId,
  processing: ProcessingStatus,
  /** Echo of which observation/photo ids were accepted (client clears those). */
  acceptedObservationIds: z.array(ClientId),
});
export type UploadResult = z.infer<typeof UploadResult>;

// ---------------------------------------------------------------------------
// Review-before-send (spec §3, hard requirement)
// ---------------------------------------------------------------------------

/** The super's inline edits. Only prose is editable; media/order are immutable. */
export const ReportEdit = z.object({
  summary: z.string().optional(),
  observations: z
    .array(
      z.object({
        id: ClientId,
        cleanedDescription: z.string().optional(),
        trade: z.string().optional(),
        area: z.string().optional(),
      }),
    )
    .optional(),
});
export type ReportEdit = z.infer<typeof ReportEdit>;

// ---------------------------------------------------------------------------
// Admin (raw-vs-polished, spec §3)
// ---------------------------------------------------------------------------

export const AdminObservationView = z.object({
  id: ClientId,
  order: z.number().int().nonnegative(),
  photoUrls: z.array(z.string()),
  audioUrl: z.string().optional(),
  transcript: z.string().optional(), // verbatim
  cleanedDescription: z.string().optional(), // polished
  trade: z.string().optional(),
  area: z.string().optional(),
});
export type AdminObservationView = z.infer<typeof AdminObservationView>;

export const AdminReportView = z.object({
  report: Report,
  observations: z.array(AdminObservationView),
});
export type AdminReportView = z.infer<typeof AdminReportView>;

// ---------------------------------------------------------------------------
// Auth + multi-tenancy + distribution (v1.2.0, AUTH_MULTITENANCY_PLAN.md §2)
// ---------------------------------------------------------------------------

/** The only user shape that ever leaves the server — NEVER includes password_hash. */
export const PublicUser = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string().optional(),
});
export type PublicUser = z.infer<typeof PublicUser>;

export const Org = z.object({ id: z.string(), name: z.string() });
export type Org = z.infer<typeof Org>;

export const Membership = z.object({ orgId: z.string(), orgRole: OrgRole });
export type Membership = z.infer<typeof Membership>;

export const ProjectMember = z.object({
  projectId: z.string(),
  userId: z.string(),
  role: ProjectRole,
  user: PublicUser.optional(),
});
export type ProjectMember = z.infer<typeof ProjectMember>;

// Auth DTOs (plan §4.2).

// Upper bounds matter: without .max(), an 8MB password gets argon2id-hashed per
// attempt (cheap DoS) and an oversized email overflows the btree unique-index row
// limit. 254 = RFC 5321 address ceiling; 128 is generous for passphrases.

export const SignupRequest = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(200),
  orgName: z.string().min(1).max(200),
});
export type SignupRequest = z.infer<typeof SignupRequest>;

export const LoginRequest = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const AcceptInviteRequest = z.object({
  token: z.string().max(128),
  name: z.string().min(1).max(200),
  password: z.string().min(8).max(128),
});
export type AcceptInviteRequest = z.infer<typeof AcceptInviteRequest>;

/** Create-invitation body (org admin). Lives here so the web app and server validate the
 *  same shape; projectAssignments are re-validated server-side against the org (§6). */
export const CreateInvitationRequest = z.object({
  email: z.string().email().max(254),
  orgRole: OrgRole.default('member'),
  projectAssignments: z
    .array(z.object({ projectId: z.string().max(100), role: ProjectRole }))
    .max(50)
    .default([]),
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

export const AuthResponse = z.object({
  /** Opaque bearer session token (T-1); the SPA stores it and sends Authorization: Bearer. */
  token: z.string(),
  user: PublicUser,
  orgs: z.array(Org.extend({ role: OrgRole })),
});
export type AuthResponse = z.infer<typeof AuthResponse>;

/** Accept-invite result. A brand-new or still-pending account is activated with the
 *  supplied credentials and logged straight in (AuthResponse). But an invite for an
 *  ALREADY-ACTIVE account only ADDS the membership — it never mints a session for the
 *  token holder (that would be account takeover); the invitee must log in themselves. */
export const AcceptInviteResponse = z.union([
  AuthResponse,
  z.object({ requiresLogin: z.literal(true), email: z.string() }),
]);
export type AcceptInviteResponse = z.infer<typeof AcceptInviteResponse>;

export const Me = z.object({
  user: PublicUser,
  orgs: z.array(Org.extend({ role: OrgRole })),
});
export type Me = z.infer<typeof Me>;

// Stakeholder directory (plan §7, D-8).

export const StakeholderContact = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  title: z.string().optional(),
});
export type StakeholderContact = z.infer<typeof StakeholderContact>;

export const StakeholderOrg = z.object({
  id: z.string(),
  name: z.string(),
  kind: StakeholderKind,
  contacts: z.array(StakeholderContact).default([]),
});
export type StakeholderOrg = z.infer<typeof StakeholderOrg>;

// Directory + roster request DTOs (Phase 7) — shared so the web Settings UI validates the
// same shapes the server enforces.

export const CreateStakeholderOrgRequest = z.object({
  name: z.string().min(1).max(200),
  kind: StakeholderKind,
});
export type CreateStakeholderOrgRequest = z.infer<typeof CreateStakeholderOrgRequest>;

export const UpdateStakeholderOrgRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  kind: StakeholderKind.optional(),
});
export type UpdateStakeholderOrgRequest = z.infer<typeof UpdateStakeholderOrgRequest>;

export const CreateStakeholderContactRequest = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(254),
  title: z.string().max(200).optional(),
});
export type CreateStakeholderContactRequest = z.infer<typeof CreateStakeholderContactRequest>;

export const UpdateStakeholderContactRequest = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().max(254).optional(),
  title: z.string().max(200).optional(),
});
export type UpdateStakeholderContactRequest = z.infer<typeof UpdateStakeholderContactRequest>;

/** Replace a project's roster wholesale (set semantics). */
export const SetProjectRosterRequest = z.object({
  stakeholderOrgIds: z.array(z.string().max(100)).max(200).default([]),
});
export type SetProjectRosterRequest = z.infer<typeof SetProjectRosterRequest>;

// Send + delivery (plan §8, D-9).

/** Who to send to: whole stakeholder orgs, specific contacts, and typed one-offs. */
export const SendSelection = z.object({
  orgIds: z.array(z.string()).default([]),
  contactIds: z.array(z.string()).default([]),
  adHoc: z
    .array(z.object({ name: z.string(), email: z.string().email() }))
    .default([]),
});
export type SendSelection = z.infer<typeof SendSelection>;

export const SendRequest = z.object({
  selection: SendSelection,
  message: z.string().max(2000).optional(),
  /** Per-person link lifetime (D-9: 30d default, revocable). Capped at a year — an
   *  unbounded value overflows the JS Date range when expires_at is computed. */
  expiresInDays: z.number().int().positive().max(365).default(30),
});
export type SendRequest = z.infer<typeof SendRequest>;

export const Recipient = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  /** Stakeholder org display name, when the recipient came from the directory. */
  org: z.string().optional(),
  sentAt: Iso8601,
  firstOpenedAt: Iso8601.optional(),
  revokedAt: Iso8601.optional(),
  openCount: z.number().int(),
});
export type Recipient = z.infer<typeof Recipient>;

export const ReportSend = z.object({
  id: z.string(),
  reportId: z.string(),
  sentBy: PublicUser,
  sentAt: Iso8601,
  recipients: z.array(Recipient),
});
export type ReportSend = z.infer<typeof ReportSend>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Canonical multipart field name for an observation's audio part. */
export const audioFieldFor = (observationId: string) => `audio:${observationId}`;

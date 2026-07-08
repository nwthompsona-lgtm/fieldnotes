/**
 * Data-access seam. The db leaf module implements `getDb`/`ensureSchema`/`makeRepo`;
 * the orchestrator-owned wiring (routes, pipeline) consumes `Repo`. Repo speaks in
 * CONTRACT types (`@fieldreport/contracts`) so callers never touch Drizzle rows.
 */
import type {
  Report,
  ReportEdit,
  ReportStatus,
  ProcessingStatus,
  Project,
  UploadManifest,
  Org,
  OrgRole,
  ProjectRole,
  ProjectVisibility,
  PublicUser,
  ProjectMember,
  StakeholderOrg,
  StakeholderContact,
  StakeholderKind,
  SendSelection,
  ReportSend,
} from '@fieldreport/contracts';
import type { SynthesisOutput } from '../synthesis/types.js';
import type { UserRow, InvitationRow, ReportSendRecipientRow } from './schema.js';

/** Internal row shapes the auth layer needs (UserRow carries passwordHash — it never
 *  crosses a route boundary; PublicUser is the outward shape). */
export type { UserRow, InvitationRow };
export type RecipientRow = ReportSendRecipientRow;

/** Opaque DB handle (drizzle instance over pglite|pg). */
export type Db = unknown;

/** Storage keys (and server-corrected photo dims) resolved by ingest before rows
 *  are written. Dims come from the EXIF-corrected/resized image, not the client. */
export interface IngestMediaKeys {
  /** photoId -> stored photo metadata */
  photos: Record<
    string,
    { key: string; width: number; height: number; byteSize: number }
  >;
  /** observationId -> { key, mime, ext } */
  audio: Record<string, { key: string; mime: string; ext: string }>;
}

/** One observation's processing inputs (audio + keyterm assembly happens in caller). */
export interface ProcessingObservation {
  id: string;
  order: number;
  audioKey: string | null;
  audioMime: string | null;
  photoCount: number;
}

/** Quality signals for one observation: the AI's first draft vs the (possibly edited)
 *  final, plus the STT confidence. Powers edit-distance + sent-unmodified metrics. */
export interface ObservationQuality {
  id: string;
  cleanedDescription: string | null;
  aiCleanedDescription: string | null;
  transcriptConfidence: number | null;
}

/** Per-report quality signals for LangSmith feedback + the admin metrics rollup. */
export interface ReportQuality {
  id: string;
  /** Root LangSmith run id, if tracing was on when this report was processed. */
  runId: string | null;
  status: ReportStatus;
  processing: ProcessingStatus;
  createdAt: string;
  summary: string;
  aiSummary: string | null;
  observations: ObservationQuality[];
}

export interface Repo {
  // projects
  getProject(id: string): Promise<Project | null>;
  upsertProject(p: Project): Promise<void>;
  /** Ensure a project row exists for an uploaded report (the reports.projectId FK
   *  requires it). CREATE-IF-MISSING ONLY: an existing row is never touched — the
   *  manifest echoes a possibly-stale cached picker label, and renames are an admin/pm
   *  action (permission matrix), so an upload must never rename a project org-wide. */
  ensureProjectFromUpload(p: { id: string; name: string; superName: string }): Promise<void>;

  // ingest (idempotent on walkId)
  createReportFromUpload(
    manifest: UploadManifest,
    media: IngestMediaKeys,
    opts?: { createdBy?: string },
  ): Promise<{ reportId: string; created: boolean; acceptedObservationIds: string[] }>;

  // reads
  getReport(id: string): Promise<Report | null>;
  getReportStatus(
    id: string,
  ): Promise<{ status: ReportStatus; processing: ProcessingStatus; error?: string } | null>;
  /** The columns authz predicates read (projectId, status, createdBy) — cheap enough for
   *  the status-poll hot path and hosted-view guards to authorize without full assembly. */
  getReportViewMeta(
    id: string,
  ): Promise<{ id: string; projectId: string; status: ReportStatus; createdBy?: string } | null>;
  listReports(): Promise<Report[]>;
  getProcessingObservations(reportId: string): Promise<ProcessingObservation[]>;
  getReportProjectId(id: string): Promise<string | null>;

  // pipeline writes
  setProcessing(id: string, status: ProcessingStatus, error?: string): Promise<void>;
  setTranscript(observationId: string, text: string, confidence?: number): Promise<void>;
  applySynthesis(reportId: string, out: SynthesisOutput): Promise<void>;
  setRenderArtifacts(id: string, keys: { htmlKey: string; pdfKey: string }): Promise<void>;
  /** Store the root LangSmith run id so review outcomes can be attached to the trace. */
  setLangsmithRunId(id: string, runId: string): Promise<void>;

  // review gate
  applyEdit(id: string, edit: ReportEdit): Promise<Report | null>;
  finalize(id: string): Promise<Report | null>;

  // observability
  getReportQuality(id: string): Promise<ReportQuality | null>;
  listReportQuality(): Promise<ReportQuality[]>;

  // --- auth + multi-tenancy + distribution (AUTH_MULTITENANCY_PLAN.md §3) ---

  // identity (emails normalized lowercase at this layer; unique on lower(email))
  createUser(u: { id: string; email: string; name: string; passwordHash?: string }): Promise<void>;
  /** Signup: user + their org + admin membership in ONE transaction, so a mid-sequence
   *  failure can't strand an org-less account whose email is then permanently 409-blocked. */
  createUserWithOrg(args: {
    user: { id: string; email: string; name: string; passwordHash: string };
    org: { id: string; name: string };
    membership: { id: string; orgRole: OrgRole };
  }): Promise<void>;
  getUserByEmail(email: string): Promise<UserRow | null>;
  getUserById(id: string): Promise<UserRow | null>;
  /** Partial update (invite-accept sets name + first password on a pending user; also the
   *  single credential-write path — password changes go through here). */
  updateUser(id: string, patch: { name?: string; passwordHash?: string }): Promise<void>;

  // sessions (id = the opaque bearer token; expiresAt null = indefinite, D-2)
  createSession(s: { id: string; userId: string; expiresAt: Date | null }): Promise<void>;
  getSession(
    token: string,
  ): Promise<{ userId: string; expiresAt: Date | null; revokedAt: Date | null } | null>;
  /** last_seen_at = now(). Callers throttle (auth/sessions.ts); this always writes. */
  touchSession(token: string): Promise<void>;
  revokeSession(token: string): Promise<void>;

  // orgs + memberships
  createOrg(o: { id: string; name: string }): Promise<void>;
  getOrg(id: string): Promise<Org | null>;
  addMembership(m: { id: string; userId: string; orgId: string; orgRole: OrgRole }): Promise<void>;
  getMembership(userId: string, orgId: string): Promise<{ orgRole: OrgRole } | null>;
  listOrgsForUser(userId: string): Promise<Array<Org & { role: OrgRole }>>;
  listOrgMembers(
    orgId: string,
  ): Promise<Array<PublicUser & { orgRole: OrgRole; projects: ProjectMember[] }>>;
  /** Change a member's org role with the last-admin lockout enforced ATOMICALLY: the
   *  org's admin membership rows are locked (SELECT ... FOR UPDATE) and counted inside
   *  the SAME transaction as the write, so two concurrent demote/remove requests can
   *  never race a check-then-act guard and drive the org to zero admins. Returns
   *  'last-admin' (no write) when the change would demote the sole remaining admin. */
  updateMembershipRoleGuarded(
    userId: string,
    orgId: string,
    orgRole: OrgRole,
  ): Promise<'ok' | 'last-admin'>;
  /** Remove the org membership AND the user's project assignments on that org's
   *  projects (one transaction) — Settings "remove member". Same atomic last-admin
   *  guard as updateMembershipRoleGuarded: removing the sole admin returns 'last-admin'
   *  and deletes nothing. */
  removeMembershipGuarded(userId: string, orgId: string): Promise<'ok' | 'last-admin'>;

  // invitations
  createInvitation(i: {
    id: string;
    orgId: string;
    email: string;
    orgRole: OrgRole;
    projectAssignments: Array<{ projectId: string; role: ProjectRole }>;
    token: string;
    invitedBy: string;
    expiresAt: Date;
  }): Promise<void>;
  getInvitationByToken(token: string): Promise<InvitationRow | null>;
  markInvitationAccepted(id: string): Promise<void>;

  // projects (tenancy-aware; existing getProject/upsertProject stay as-is)
  /** Projects the user can see in an org: admins all; members their assignments plus
   *  visibility='org' projects (D-4). Non-members get []. */
  listProjectsForUser(userId: string, orgId: string): Promise<Project[]>;
  /** ALL of an org's projects (settings/admin surfaces — caller must already be gated). */
  listProjectsForOrg(orgId: string): Promise<Project[]>;
  /** The user's explicit project_member roles across an org's projects, batched (one
   *  query) so the shell's project switcher can label each project without N lookups. */
  listProjectRolesForUser(
    userId: string,
    orgId: string,
  ): Promise<Array<{ projectId: string; role: ProjectRole }>>;
  createProject(p: {
    id: string;
    orgId: string;
    name: string;
    superName: string;
    visibility: ProjectVisibility;
  }): Promise<void>;
  setProjectVisibility(id: string, v: ProjectVisibility): Promise<void>;
  getProjectOrgId(projectId: string): Promise<string | null>;
  addProjectMember(pm: {
    id: string;
    projectId: string;
    userId: string;
    role: ProjectRole;
  }): Promise<void>;
  removeProjectMember(projectId: string, userId: string): Promise<void>;
  /** Upsert a member's project role (unique on project+user) — Settings assignments. */
  setProjectMemberRole(pm: {
    id: string;
    projectId: string;
    userId: string;
    role: ProjectRole;
  }): Promise<void>;
  listProjectMembers(projectId: string): Promise<ProjectMember[]>;
  getProjectRole(projectId: string, userId: string): Promise<ProjectRole | null>;

  // reports (scoping; authz itself is enforced in routes — §6)
  listReportsForProject(projectId: string): Promise<Report[]>;
  /** All reports whose project belongs to one of the given orgs (admin surface). */
  listReportsForOrgs(orgIds: string[]): Promise<Report[]>;
  /** Report → its project's org (admin scoping). Null when unknown/unadopted. */
  getReportOrgId(reportId: string): Promise<string | null>;
  /** Attribution: fills created_by ONLY when currently null, so an idempotent upload
   *  retry (or the boot backfill) can never flip a report's author. */
  setReportCreatedBy(reportId: string, userId: string): Promise<void>;

  // seed / backfill (auth plan §12; all idempotent, run at boot)
  upsertOrg(o: { id: string; name: string }): Promise<void>;
  /** Total org count — the seed uses this to only blanket-adopt orphan projects while the
   *  pilot org is the sole tenant, so real multi-org data is never cross-adopted. */
  countOrgs(): Promise<number>;
  /** Adopt pre-tenancy projects: org_id = orgId where org_id IS NULL. */
  adoptOrphanProjects(orgId: string): Promise<void>;
  /** created_by = userId where created_by IS NULL, scoped to `orgId`'s projects so a
   *  null-author report in another tenant is never mis-attributed. */
  backfillReportsCreatedBy(userId: string, orgId: string): Promise<void>;
  /** Quality rollup scoped to orgs (admin metrics). */
  listReportQualityForOrgs(orgIds: string[]): Promise<ReportQuality[]>;

  // stakeholder directory (org level, D-8)
  /** Owning tenant org of a stakeholder org (null if unknown) — cross-org write guard. */
  getStakeholderOrgOrgId(id: string): Promise<string | null>;
  /** Owning tenant org of a contact, via its stakeholder org (null if unknown). */
  getStakeholderContactOrgId(id: string): Promise<string | null>;
  listStakeholderOrgs(orgId: string): Promise<StakeholderOrg[]>; // with contacts
  createStakeholderOrg(s: {
    id: string;
    orgId: string;
    name: string;
    kind: StakeholderKind;
  }): Promise<void>;
  updateStakeholderOrg(id: string, patch: { name?: string; kind?: StakeholderKind }): Promise<void>;
  deleteStakeholderOrg(id: string): Promise<void>;
  createStakeholderContact(c: {
    id: string;
    stakeholderOrgId: string;
    name: string;
    email: string;
    title?: string;
  }): Promise<void>;
  updateStakeholderContact(
    id: string,
    patch: { name?: string; email?: string; title?: string },
  ): Promise<void>;
  deleteStakeholderContact(id: string): Promise<void>;
  getContactsByIds(ids: string[]): Promise<Array<StakeholderContact & { orgName: string }>>;

  // project roster + distribution defaults (D-8)
  listProjectStakeholders(projectId: string): Promise<StakeholderOrg[]>; // roster, with contacts
  /** Replaces the roster wholesale (set semantics). */
  setProjectStakeholders(projectId: string, stakeholderOrgIds: string[]): Promise<void>;
  getDistributionDefault(projectId: string): Promise<SendSelection | null>;
  setDistributionDefault(projectId: string, selection: SendSelection): Promise<void>;

  // sends + delivery (D-9)
  createReportSend(s: {
    id: string;
    reportId: string;
    sentBy: string;
    message?: string;
  }): Promise<void>;
  createRecipients(
    rs: Array<{
      id: string;
      sendId: string;
      contactId?: string;
      email: string;
      name: string;
      token: string;
      expiresAt: Date;
    }>,
  ): Promise<void>;
  /** Resolve a SendSelection's org/contact ids to concrete contacts, scoped to `orgId`
   *  (cross-org ids resolve to nothing). Deduped by contact id; adHoc is added by the route. */
  resolveSelectionContacts(
    orgId: string,
    stakeholderOrgIds: string[],
    contactIds: string[],
  ): Promise<Array<{ contactId: string; name: string; email: string }>>;
  getRecipientByToken(token: string): Promise<(RecipientRow & { reportId: string }) | null>;
  /** By recipient id (for revoke/resend), with the owning report id for a tenancy check. */
  getRecipientById(id: string): Promise<(RecipientRow & { reportId: string }) | null>;
  /** first_opened_at ??= now(); last_opened_at = now(); open_count++ (§8.4). */
  recordRecipientOpen(token: string): Promise<void>;
  revokeRecipient(id: string): Promise<void>;
  /** Resend of an expired link: fresh token + expiry on the same row (keeps open history). */
  refreshRecipientToken(id: string, patch: { token: string; expiresAt: Date }): Promise<void>;
  /** Record the last email-dispatch outcome for a recipient: the provider's failure
   *  message on throw, or null to clear it after a later successful (re)send — so the
   *  delivery panel can say "email failed" instead of silently looking sent. */
  setRecipientEmailError(id: string, error: string | null): Promise<void>;
  listSendsForReport(reportId: string): Promise<ReportSend[]>; // with recipients (delivery panel)
  /** Latest send rollup for the report-list chip: sentAt + opened/total. */
  getReportLatestSendSummary(
    reportId: string,
  ): Promise<{ sentAt: string; opened: number; total: number } | null>;
  /** Batched latest-send rollup for a whole list: one pair of queries for all reportIds,
   *  keyed by reportId (absent = never sent). Avoids the per-row N+1 in the list route. */
  getLatestSendSummaries(
    reportIds: string[],
  ): Promise<Map<string, { sentAt: string; opened: number; total: number }>>;
}

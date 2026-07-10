/**
 * Auth + session-scoped API client (Phase 9 F1 data layer). Design-agnostic: the signup /
 * login / accept-invite SCREENS and the app shell come from the design handoff, but they
 * all call these typed functions, which bind to the frozen server contracts (§4, §6) and
 * carry the session bearer from `session.ts`. A 401 clears the session so the app falls
 * back to the login screen.
 *
 * Scope here is F1 (auth + reports list/read). The Send modal / Delivery / Settings client
 * (directory, roster, send, revoke/resend) belongs to Phase 10 and binds to §7–§8.
 */
import type {
  AuthResponse,
  Me,
  SignupRequest,
  LoginRequest,
  AcceptInviteRequest,
  AcceptInviteResponse,
  CreateInvitationRequest,
  CreateProjectRequest,
  CreateStakeholderContactRequest,
  CreateStakeholderOrgRequest,
  OrgMemberRow,
  OrgRole,
  Project,
  ProjectMember,
  ProjectRole,
  ProjectVisibility,
  Report,
  ReportSend,
  SendRequest,
  SendSelection,
  StakeholderContact,
  StakeholderOrg,
  StakeholderSuggestion,
  UpdateStakeholderContactRequest,
  UpdateStakeholderOrgRequest,
} from '@fieldreport/contracts';
import { API_BASE } from './config';
import { ApiError } from './api';
import { authHeaders, setSessionToken, clearSession } from './session';

/** A report row from GET /api/reports?projectId — the contract Report plus the list chip. */
export type ReportListRow = Report & {
  lastSend: { sentAt: string; opened: number; total: number } | null;
};

/** Preview shape for the accept-invite screen (GET /api/auth/invitations/:token). */
export interface InvitePreview {
  orgName: string;
  email: string;
  orgRole: OrgRole;
}

/** fetch wrapper that injects the session bearer and JSON headers, throws ApiError on
 *  non-2xx, and clears the session on 401 so the UI re-prompts login. */
async function authed<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, `Could not reach the server at ${API_BASE}.`);
  }
  if (res.status === 401) {
    clearSession();
    throw new ApiError(401, 'Your session has expired — please sign in again.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail || `Request failed (${res.status} ${res.statusText}).`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const jsonBody = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// ── Auth (§4.2) ───────────────────────────────────────────────────────────────
/** Persist the session and return the auth payload (used by signup/login/accept). */
function landSession(auth: AuthResponse): AuthResponse {
  setSessionToken(auth.token);
  return auth;
}

export async function signup(body: SignupRequest): Promise<AuthResponse> {
  return landSession(await authed<AuthResponse>('/api/auth/signup', jsonBody(body)));
}

export async function login(body: LoginRequest): Promise<AuthResponse> {
  return landSession(await authed<AuthResponse>('/api/auth/login', jsonBody(body)));
}

export async function logout(): Promise<void> {
  try {
    await authed<void>('/api/auth/logout', { method: 'POST' });
  } finally {
    clearSession(); // clear locally even if the revoke call failed
  }
}

export function me(): Promise<Me> {
  return authed<Me>('/api/auth/me');
}

// ── Invitations (§4.2) ─────────────────────────────────────────────────────────
export function previewInvite(token: string): Promise<InvitePreview> {
  return authed<InvitePreview>(`/api/auth/invitations/${encodeURIComponent(token)}`);
}

/** Accept an invite. A new/pending account is activated + logged in (AuthResponse); an
 *  existing active account only gains the membership and must log in ({ requiresLogin }). */
export async function acceptInvite(body: AcceptInviteRequest): Promise<AcceptInviteResponse> {
  const res = await authed<AcceptInviteResponse>('/api/auth/invitations/accept', jsonBody(body));
  if ('token' in res) landSession(res);
  return res;
}

// ── Workspace (§9 app shell) ────────────────────────────────────────────────────
/** A project row plus the caller's explicit project role (null = visible only via org
 *  visibility or org-admin) — drives the permission-matrix gating in the UI. */
export type ProjectWithRole = Project & { role: ProjectRole | null };

/** Projects the caller can see in an org (drives the project switcher). */
export function listProjects(orgId: string): Promise<ProjectWithRole[]> {
  return authed<ProjectWithRole[]>(`/api/orgs/${encodeURIComponent(orgId)}/projects`);
}

// ── Reports (§6.2–§6.3) ─────────────────────────────────────────────────────────
export function listReports(projectId: string): Promise<ReportListRow[]> {
  return authed<ReportListRow[]>(`/api/reports?projectId=${encodeURIComponent(projectId)}`);
}

export function getReport(id: string): Promise<Report> {
  return authed<Report>(`/api/reports/${encodeURIComponent(id)}`);
}

// ── Send + delivery (§8, Phase 10 F2) ───────────────────────────────────────────
const enc = encodeURIComponent;

export function sendReport(reportId: string, body: SendRequest): Promise<ReportSend> {
  return authed<ReportSend>(`/api/reports/${enc(reportId)}/send`, jsonBody(body));
}

export function listSends(reportId: string): Promise<ReportSend[]> {
  return authed<ReportSend[]>(`/api/reports/${enc(reportId)}/sends`);
}

export function revokeRecipient(reportId: string, recipientId: string): Promise<void> {
  return authed<void>(`/api/reports/${enc(reportId)}/recipients/${enc(recipientId)}/revoke`, {
    method: 'POST',
  });
}

/** Resend outcome — ok:false carries the provider's rejection message (the email is
 *  best-effort server-side, so the HTTP call itself still succeeds; read the flag). */
export interface ResendOutcome {
  ok: boolean;
  error?: string;
  recipientId: string;
  resentTo: string;
}

export function resendRecipient(
  reportId: string,
  recipientId: string,
): Promise<ResendOutcome> {
  return authed<ResendOutcome>(
    `/api/reports/${enc(reportId)}/recipients/${enc(recipientId)}/resend`,
    { method: 'POST' },
  );
}

// ── Roster + distribution default (§7) ──────────────────────────────────────────
export function getRoster(projectId: string): Promise<StakeholderOrg[]> {
  return authed<StakeholderOrg[]>(`/api/projects/${enc(projectId)}/stakeholders`);
}

export function setRoster(
  projectId: string,
  stakeholderOrgIds: string[],
): Promise<StakeholderOrg[]> {
  return authed<StakeholderOrg[]>(`/api/projects/${enc(projectId)}/stakeholders`, {
    ...jsonBody({ stakeholderOrgIds }),
    method: 'PUT',
  });
}

export function getDistributionDefault(projectId: string): Promise<SendSelection | null> {
  return authed<SendSelection | null>(`/api/projects/${enc(projectId)}/distribution-default`);
}

/** Send-modal typeahead (14b): org-wide directory matches for a 2+ char query. */
export function getStakeholderSuggestions(
  projectId: string,
  q: string,
): Promise<StakeholderSuggestion[]> {
  return authed<StakeholderSuggestion[]>(
    `/api/projects/${enc(projectId)}/stakeholder-suggestions?q=${encodeURIComponent(q)}`,
  );
}

// ── Stakeholder directory (§7, org admin) ───────────────────────────────────────
export function listStakeholders(orgId: string): Promise<StakeholderOrg[]> {
  return authed<StakeholderOrg[]>(`/api/orgs/${enc(orgId)}/stakeholders`);
}

export function createStakeholderOrg(
  orgId: string,
  body: CreateStakeholderOrgRequest,
): Promise<StakeholderOrg> {
  return authed<StakeholderOrg>(`/api/orgs/${enc(orgId)}/stakeholders`, jsonBody(body));
}

export function updateStakeholderOrg(
  orgId: string,
  sid: string,
  body: UpdateStakeholderOrgRequest,
): Promise<void> {
  return authed<void>(`/api/orgs/${enc(orgId)}/stakeholders/${enc(sid)}`, {
    ...jsonBody(body),
    method: 'PATCH',
  });
}

export function deleteStakeholderOrg(orgId: string, sid: string): Promise<void> {
  return authed<void>(`/api/orgs/${enc(orgId)}/stakeholders/${enc(sid)}`, { method: 'DELETE' });
}

export function createStakeholderContact(
  orgId: string,
  sid: string,
  body: CreateStakeholderContactRequest,
): Promise<StakeholderContact> {
  return authed<StakeholderContact>(
    `/api/orgs/${enc(orgId)}/stakeholders/${enc(sid)}/contacts`,
    jsonBody(body),
  );
}

export function updateStakeholderContact(
  orgId: string,
  sid: string,
  cid: string,
  body: UpdateStakeholderContactRequest,
): Promise<void> {
  return authed<void>(`/api/orgs/${enc(orgId)}/stakeholders/${enc(sid)}/contacts/${enc(cid)}`, {
    ...jsonBody(body),
    method: 'PATCH',
  });
}

export function deleteStakeholderContact(orgId: string, sid: string, cid: string): Promise<void> {
  return authed<void>(`/api/orgs/${enc(orgId)}/stakeholders/${enc(sid)}/contacts/${enc(cid)}`, {
    method: 'DELETE',
  });
}

// ── Settings: members & projects (Phase 10 F2) ──────────────────────────────────
export function listMembers(orgId: string): Promise<OrgMemberRow[]> {
  return authed<OrgMemberRow[]>(`/api/orgs/${enc(orgId)}/members`);
}

export function setMemberRole(orgId: string, userId: string, orgRole: OrgRole): Promise<void> {
  return authed<void>(`/api/orgs/${enc(orgId)}/members/${enc(userId)}`, {
    ...jsonBody({ orgRole }),
    method: 'PATCH',
  });
}

export function removeMember(orgId: string, userId: string): Promise<void> {
  return authed<void>(`/api/orgs/${enc(orgId)}/members/${enc(userId)}`, { method: 'DELETE' });
}

export function createInvitation(
  orgId: string,
  body: CreateInvitationRequest,
): Promise<{ token: string; inviteUrl: string }> {
  return authed<{ token: string; inviteUrl: string }>(
    `/api/orgs/${enc(orgId)}/invitations`,
    jsonBody(body),
  );
}

export function createProject(orgId: string, body: CreateProjectRequest): Promise<ProjectWithRole> {
  return authed<ProjectWithRole>(`/api/orgs/${enc(orgId)}/projects`, jsonBody(body));
}

export function setProjectVisibility(
  projectId: string,
  visibility: ProjectVisibility,
): Promise<void> {
  return authed<void>(`/api/projects/${enc(projectId)}`, {
    ...jsonBody({ visibility }),
    method: 'PATCH',
  });
}

export function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  return authed<ProjectMember[]>(`/api/projects/${enc(projectId)}/members`);
}

export function setProjectMember(
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<void> {
  return authed<void>(`/api/projects/${enc(projectId)}/members/${enc(userId)}`, {
    ...jsonBody({ role }),
    method: 'PUT',
  });
}

export function removeProjectMember(projectId: string, userId: string): Promise<void> {
  return authed<void>(`/api/projects/${enc(projectId)}/members/${enc(userId)}`, {
    method: 'DELETE',
  });
}

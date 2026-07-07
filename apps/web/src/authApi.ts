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
  OrgRole,
  Report,
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

// ── Reports (§6.2–§6.3) ─────────────────────────────────────────────────────────
export function listReports(projectId: string): Promise<ReportListRow[]> {
  return authed<ReportListRow[]>(`/api/reports?projectId=${encodeURIComponent(projectId)}`);
}

export function getReport(id: string): Promise<Report> {
  return authed<Report>(`/api/reports/${encodeURIComponent(id)}`);
}

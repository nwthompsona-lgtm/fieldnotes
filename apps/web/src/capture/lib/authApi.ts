// Auth + workspace client (Phase 11 / F3) — binds the capture app to the Phase 3–4
// endpoints. Deliberately tiny: login/logout/me plus the org-project listing that feeds
// the project picker. Every call carries the session bearer; a 401 clears the session so
// the app falls back to the login screen (capture data in IndexedDB is untouched).
import type { AuthResponse, Me, Project, ProjectRole } from '@fieldreport/contracts';
import { API_BASE } from '../config';
import { authHeaders, clearSession, setSession } from './session';

/** Error with the HTTP status attached, so callers can branch (401 vs 429 vs offline=0). */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function authed<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, "Can't reach the server — check your connection.");
  }
  if (res.status === 401) {
    clearSession();
    throw new ApiError(401, 'Your session has expired — please log in again.');
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail || `Request failed (HTTP ${res.status}).`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const jsonBody = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** Log in and persist the session + account. 401 = bad credentials (session untouched
 *  because none was sent), 429 = throttled. */
export async function login(email: string, password: string): Promise<AuthResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/auth/login`, jsonBody({ email, password }));
  } catch {
    throw new ApiError(0, "Can't reach the server — check your connection.");
  }
  if (!res.ok) {
    if (res.status === 401) throw new ApiError(401, "That email or password didn't match.");
    if (res.status === 429)
      throw new ApiError(429, 'Too many attempts — wait a minute and try again.');
    throw new ApiError(res.status, `Login failed (HTTP ${res.status}).`);
  }
  const auth = (await res.json()) as AuthResponse;
  setSession(auth.token, auth.user);
  return auth;
}

/** Revoke the session server-side; always clears the local session. */
export async function logout(): Promise<void> {
  try {
    await authed<void>('/api/auth/logout', { method: 'POST' });
  } catch {
    /* revoke is best-effort — local clear below is what matters */
  } finally {
    clearSession();
  }
}

/** The signed-in user + org memberships. Refreshes the cached account on success. */
export function me(): Promise<Me> {
  return authed<Me>('/api/auth/me');
}

/** A project row plus the caller's explicit project role (null = visible via org
 *  visibility / org-admin only) — same shape the web app's switcher uses. */
export type ProjectWithRole = Project & { role: ProjectRole | null };

export function listProjects(orgId: string): Promise<ProjectWithRole[]> {
  return authed<ProjectWithRole[]>(`/api/orgs/${encodeURIComponent(orgId)}/projects`);
}

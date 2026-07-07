// Capture session store (Phase 11 / F3; T-1: opaque bearer in localStorage).
//
// OFFLINE-FIRST: the capture app must keep working in a dead zone, so alongside the
// token we cache the signed-in account (id/email/name). Presence of the token = logged
// in; the cached account renders the UI offline; a live `me()` refresh replaces it when
// the network is back. Only an explicit 401 (server said the session is gone) logs the
// user out — network failures never do. A tiny pub/sub lets React subscribe
// (useSyncExternalStore) so login/logout re-render the app without a reload.
import type { PublicUser } from '@fieldreport/contracts';

const TOKEN_KEY = 'fieldreport.sessionToken';
const ACCOUNT_KEY = 'fieldreport.account';

const listeners = new Set<() => void>();

/** The persisted session bearer, or null when logged out. */
export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null; // private-mode / storage-disabled: treat as logged out
  }
}

/** The cached signed-in account (from the last successful login/me), or null. */
export function getAccount(): PublicUser | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as PublicUser) : null;
  } catch {
    return null;
  }
}

/** Persist a fresh session + account (login) or refresh the account (me). */
export function setSession(token: string, user: PublicUser): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable — the session lives only for this tab */
  }
  emit();
}

export function setAccount(user: PublicUser): void {
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(user));
  } catch {
    /* non-fatal */
  }
  emit();
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/** Authorization header for the current session (empty object when logged out). */
export function authHeaders(): Record<string, string> {
  const t = getSessionToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

/** Subscribe to login/logout (and cross-tab changes). Returns an unsubscribe fn. */
export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(): void {
  for (const fn of listeners) fn();
}

// Reflect logout/login performed in another tab.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY || e.key === ACCOUNT_KEY) emit();
  });
}

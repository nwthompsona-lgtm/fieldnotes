/**
 * Session token store (Phase 9 data layer, T-1: opaque bearer in localStorage). Design-
 * agnostic: the auth SCREENS come from the design handoff, but every screen reads/writes
 * the session through this one module and sends it via `authHeaders()`. A tiny pub/sub lets
 * React subscribe (useSyncExternalStore) so login/logout re-render the app without a reload.
 */
import { SESSION_TOKEN_KEY } from './config';

const listeners = new Set<() => void>();

/** The persisted session bearer, or null when logged out. */
export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null; // private-mode / storage-disabled: treat as logged out
  }
}

export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    /* storage unavailable — the token lives only for this tab's memory of it */
  }
  emit();
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_TOKEN_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

/** Authorization header for the current session (empty object when logged out), spread
 *  into a fetch init: `fetch(url, { headers: { ...authHeaders() } })`. */
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
    if (e.key === SESSION_TOKEN_KEY) emit();
  });
}

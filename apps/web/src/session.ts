/**
 * Session token store (Phase 9 data layer, T-1: opaque bearer in localStorage). Design-
 * agnostic: the auth SCREENS come from the design handoff, but every screen reads/writes
 * the session through this one module and sends it via `authHeaders()`. A tiny pub/sub lets
 * React subscribe (useSyncExternalStore) so login/logout re-render the app without a reload.
 */
import { SESSION_TOKEN_KEY } from './config';

const listeners = new Set<() => void>();

/** In-memory fallback for the token when localStorage is blocked (private mode /
 *  storage-disabled). Always maintained alongside the persisted copy so a failed
 *  setItem doesn't silently loop the user back to login — the session then simply
 *  lives only as long as this tab. */
let memoryToken: string | null = null;

/** The persisted session bearer (in-memory fallback when storage is blocked), or null
 *  when logged out. */
export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setSessionToken(token: string): void {
  memoryToken = token;
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch {
    /* storage unavailable — memoryToken above keeps the session for this tab */
  }
  emit();
}

export function clearSession(): void {
  memoryToken = null;
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

// Reflect logout/login performed in another tab. Mirror the change into the in-memory
// fallback too, so it can't resurrect a token another tab just cleared.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === SESSION_TOKEN_KEY) {
      memoryToken = e.newValue;
      emit();
    }
  });
}

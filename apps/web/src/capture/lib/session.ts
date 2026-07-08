// Capture session facade (Phase 13a — one app, one session).
//
// The TOKEN now lives in the web app's single session store (../../session.ts, same
// `fieldreport.sessionToken` key both apps already used) — log in once anywhere on the
// origin and both the capture flow and the management surfaces are signed in.
//
// What stays capture-local is the OFFLINE-FIRST account cache: the capture flow must
// keep working in a dead zone, so alongside the token we cache the signed-in account
// (id/email/name). Presence of the token = logged in; the cached account renders the UI
// offline; a live `me()` refresh replaces it when the network is back. Only an explicit
// 401 (server said the session is gone) logs the user out — network failures never do.
import type { PublicUser } from '@fieldreport/contracts';
import {
  getSessionToken as webGetSessionToken,
  setSessionToken as webSetSessionToken,
  clearSession as webClearSession,
  authHeaders as webAuthHeaders,
  subscribeSession as webSubscribeSession,
} from '../../session';

const ACCOUNT_KEY = 'fieldreport.account';

const listeners = new Set<() => void>();

// In-memory fallback for the account (the token's fallback lives in the web store).
// When localStorage.setItem throws (blocked storage / quota), setters ALWAYS write
// here and the getter falls back, so the session survives for this tab.
let memAccount: PublicUser | null = null;

/** The persisted session bearer, or null when logged out (shared with the whole app). */
export const getSessionToken = webGetSessionToken;

/** Authorization header for the current session (empty object when logged out). */
export const authHeaders = webAuthHeaders;

/** The cached signed-in account (from the last successful login/me), or null. */
export function getAccount(): PublicUser | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY);
    return raw ? (JSON.parse(raw) as PublicUser) : memAccount;
  } catch {
    return memAccount;
  }
}

/** Persist a fresh session + account (login) or refresh the account (me). */
export function setSession(token: string, user: PublicUser): void {
  memAccount = user;
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(user));
  } catch {
    /* storage unavailable — memAccount keeps this tab working */
  }
  webSetSessionToken(token); // emits web-side (subscribers hear it via the bridge)
  emit();
}

export function setAccount(user: PublicUser): void {
  memAccount = user;
  try {
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(user));
  } catch {
    /* non-fatal */
  }
  emit();
}

export function clearSession(): void {
  memAccount = null;
  try {
    localStorage.removeItem(ACCOUNT_KEY);
  } catch {
    /* ignore */
  }
  webClearSession(); // emits web-side
  emit();
}

/** Subscribe to login/logout and account refreshes (including cross-tab changes and
 *  token changes made by the management surfaces). Returns an unsubscribe fn. */
export function subscribeSession(fn: () => void): () => void {
  listeners.add(fn);
  // Bridge: token changes performed OUTSIDE this facade (web login/logout page,
  // another tab) must re-render capture consumers too.
  const unWeb = webSubscribeSession(fn);
  return () => {
    listeners.delete(fn);
    unWeb();
  };
}

function emit(): void {
  for (const fn of listeners) fn();
}

// Reflect account changes from another tab (the web store owns the token key's
// listener). Mirror into the in-memory fallback so a cross-tab logout can't be
// masked by a stale cached account.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === ACCOUNT_KEY) {
      try {
        memAccount = e.newValue ? (JSON.parse(e.newValue) as PublicUser) : null;
      } catch {
        memAccount = null;
      }
      emit();
    }
  });
}

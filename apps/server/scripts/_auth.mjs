// Shared helper for the dev scripts: the API is authenticated since Phase 4, so scripts
// log in for a session bearer and send it on every call. Upload/report routes need a real
// session (org-admin/super); the pilot admin (PILOT_SUPER_EMAIL/PILOT_SUPER_PASSWORD, the
// same creds the server seed provisions) is the natural identity for local/dev runs.

export async function login(base, email, password) {
  if (!email || !password) {
    throw new Error(
      'Set PILOT_SUPER_EMAIL and PILOT_SUPER_PASSWORD (the seeded pilot admin) so the script ' +
        'can authenticate against the now-guarded API.',
    );
  }
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(
      `login failed: HTTP ${res.status} — check PILOT_SUPER_EMAIL/PILOT_SUPER_PASSWORD match ` +
        'the server, and that the server seeded the pilot admin (both env vars set at boot).',
    );
  }
  return (await res.json()).token;
}

/** Authorization header for a session bearer, spread into a fetch headers object. */
export const auth = (token) => ({ authorization: `Bearer ${token}` });

/**
 * The user→response projection boundary. `publicUser` is the ONLY way a user row becomes
 * an outward shape, so passwordHash can never leak by a careless spread; `buildAuthResponse`
 * is the one place login / signup / invite-accept assemble their { token, user, orgs } body.
 */
import type { AuthResponse, PublicUser } from '@fieldreport/contracts';
import type { Repo, UserRow } from '../db/types.js';
import type { SessionManager } from './sessions.js';

export function publicUser(user: Pick<UserRow, 'id' | 'email' | 'name'>): PublicUser {
  return { id: user.id, email: user.email, name: user.name };
}

/** Mint a session for `user` and build the standard auth payload (their orgs + roles). */
export async function buildAuthResponse(
  deps: { repo: Repo; sessions: SessionManager },
  user: Pick<UserRow, 'id' | 'email' | 'name'>,
): Promise<AuthResponse> {
  const token = await deps.sessions.issue(user.id);
  return { token, user: publicUser(user), orgs: await deps.repo.listOrgsForUser(user.id) };
}

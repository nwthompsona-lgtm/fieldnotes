/**
 * Invitations (auth plan §4.2, Phase 6): an org admin invites by email with optional
 * per-project role assignments; the invitee lands on the web app's accept screen and
 * arrives with the right org + project roles (D-5).
 *
 * Security posture: the invite token is a capability mailed to the invitee's address.
 * Accepting sets name+password ONLY on a user that has no password yet (new or pending),
 * and only THEN issues a session. An account that already has credentials keeps them AND
 * is never logged in for the token holder — a leaked/replayed invite must never become a
 * password reset OR an account takeover; for an existing account it can only ADD the
 * membership, and the real owner must sign in themselves (requiresLogin).
 */
import type { FastifyInstance } from 'fastify';
import {
  AcceptInviteRequest,
  CreateInvitationRequest,
  type AcceptInviteResponse,
} from '@fieldreport/contracts';
import type { ServerDeps } from '../deps.js';
import { newId, secretToken } from '../ids.js';
import { isUniqueViolation } from '../db/errors.js';
import { hash } from './passwords.js';
import { requireAuth } from './context.js';
import { throttle } from './throttle.js';
import { buildAuthResponse } from './identity.js';
import { inviteEmail, sendBestEffort } from '../email/index.js';
import type { InvitationRow } from '../db/types.js';

/** Two weeks: long enough for construction-office latency, short enough to bound the
 *  window a lost token matters. Re-invite when it lapses. */
const INVITE_TTL_DAYS = 14;

export function registerInvitationRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { repo, sessions, authz, config } = deps;

  /** Accept links land on the web SPA (§9); locally (no WEB_BASE_URL) fall back to the
   *  API origin so the link is at least well-formed. */
  const acceptUrlFor = (token: string): string =>
    `${config.app.webBaseUrl ?? config.publicBaseUrl}/accept?token=${token}`;

  /** Shared invitation validation → row, or an error reply already sent. */
  const resolveInvitation = async (
    token: string,
  ): Promise<{ ok: true; inv: InvitationRow } | { ok: false; code: number; error: string }> => {
    const inv = await repo.getInvitationByToken(token);
    if (!inv) return { ok: false, code: 404, error: 'invitation not found' };
    if (inv.acceptedAt) return { ok: false, code: 410, error: 'invitation already used' };
    if (inv.expiresAt.getTime() < Date.now()) {
      return { ok: false, code: 410, error: 'invitation expired — ask for a new one' };
    }
    return { ok: true, inv };
  };

  // ── Create (org admin) ──────────────────────────────────────────────────────
  app.post<{ Params: { orgId: string } }>(
    '/api/orgs/:orgId/invitations',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { orgId } = req.params;
      if (!(await authz.isOrgAdmin(req, orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const parsed = CreateInvitationRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid invitation', issues: parsed.error.issues });
      }
      // Assignments must reference THIS org's projects — an admin of org A must not be
      // able to grant roles on org B's projects via a crafted projectId.
      for (const a of parsed.data.projectAssignments) {
        if ((await repo.getProjectOrgId(a.projectId)) !== orgId) {
          return reply
            .code(400)
            .send({ error: `project ${a.projectId} does not belong to this org` });
        }
      }

      const org = await repo.getOrg(orgId);
      const token = secretToken('inv');
      await repo.createInvitation({
        id: newId('inv'),
        orgId,
        email: parsed.data.email,
        orgRole: parsed.data.orgRole,
        projectAssignments: parsed.data.projectAssignments,
        token,
        invitedBy: req.auth!.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
      });

      const inviteUrl = acceptUrlFor(token);
      // Best-effort email: the admin still gets the copyable link if sending fails.
      const rendered = inviteEmail({
        orgName: org?.name ?? 'your organization',
        inviterName: req.auth!.user.name ?? 'An admin',
        acceptUrl: inviteUrl,
        orgRole: parsed.data.orgRole,
      });
      await sendBestEffort(
        deps.email,
        { to: { email: parsed.data.email }, ...rendered },
        (o, m) => req.log.error(o, m),
      );
      return { token, inviteUrl };
    },
  );

  // ── Preview (accept screen bootstrap; unauthenticated) ─────────────────────
  app.get<{ Params: { token: string } }>(
    '/api/auth/invitations/:token',
    { preHandler: throttle },
    async (req, reply) => {
      const r = await resolveInvitation(req.params.token);
      if (!r.ok) return reply.code(r.code).send({ error: r.error });
      const org = await repo.getOrg(r.inv.orgId);
      return { orgName: org?.name ?? '', email: r.inv.email, orgRole: r.inv.orgRole };
    },
  );

  // ── Accept (unauthenticated; issues a session only when it sets credentials) ──
  app.post('/api/auth/invitations/accept', { preHandler: throttle }, async (req, reply) => {
    const parsed = AcceptInviteRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid accept', issues: parsed.error.issues });
    }
    const r = await resolveInvitation(parsed.data.token);
    if (!r.ok) return reply.code(r.code).send({ error: r.error });
    const { inv } = r;

    // Resolve (or create) the account for the invited address. `credentialsJustSet` tracks
    // whether THIS request set the password — the ONLY case in which we may issue a session.
    let user = await repo.getUserByEmail(inv.email);
    let credentialsJustSet = false;
    if (!user) {
      try {
        await repo.createUser({
          id: newId('usr'),
          email: inv.email,
          name: parsed.data.name,
          passwordHash: await hash(parsed.data.password),
        });
        credentialsJustSet = true;
      } catch (err) {
        // A concurrent accept of the same fresh token may have created the row first;
        // that's not a 500 — fall through and treat the existing account as canonical.
        if (!isUniqueViolation(err)) throw err;
      }
      user = await repo.getUserByEmail(inv.email);
    }
    if (!user) return reply.code(500).send({ error: 'could not accept invitation' });

    if (!credentialsJustSet && !user.passwordHash) {
      // Pending (passwordless) account invited earlier, never activated: this IS the
      // activation — set the name + first password the invitee just chose.
      await repo.updateUser(user.id, {
        name: parsed.data.name,
        passwordHash: await hash(parsed.data.password),
      });
      credentialsJustSet = true;
    }
    // else (has a password, not just set by us): ACTIVE account — its credentials/name
    // stand; the invite only ADDS the membership below, never a session for this caller.

    if (!(await repo.getMembership(user.id, inv.orgId))) {
      await repo.addMembership({
        id: newId('mem'),
        userId: user.id,
        orgId: inv.orgId,
        orgRole: inv.orgRole,
      });
    }
    for (const a of inv.projectAssignments) {
      // Re-validate org ownership (defense in depth vs rows minted by older code).
      if ((await repo.getProjectOrgId(a.projectId)) !== inv.orgId) continue;
      if (!(await repo.getProjectRole(a.projectId, user.id))) {
        await repo.addProjectMember({
          id: newId('pm'),
          projectId: a.projectId,
          userId: user.id,
          role: a.role,
        });
      }
    }
    await repo.markInvitationAccepted(inv.id);

    if (credentialsJustSet) {
      const body: AcceptInviteResponse = await buildAuthResponse(deps, user);
      return body;
    }
    // Existing active account: membership added, but the token holder is NOT logged in as
    // them — they must sign in with their own password (account-takeover guard, §4.2).
    const body: AcceptInviteResponse = { requiresLogin: true, email: user.email };
    return body;
  });
}

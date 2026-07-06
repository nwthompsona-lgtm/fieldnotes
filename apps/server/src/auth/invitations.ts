/**
 * Invitations (auth plan §4.2, Phase 6): an org admin invites by email with optional
 * per-project role assignments; the invitee lands on the web app's accept screen and
 * arrives with the right org + project roles and a live session (D-5).
 *
 * Security posture: the invite token is a capability mailed to the invitee's address.
 * Accepting sets name+password ONLY on a user that has no password yet (new or
 * pending). An existing account with credentials keeps them — a leaked invite token
 * must never become a password reset / account takeover; it can only ADD a membership
 * for the address it was mailed to.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AcceptInviteRequest,
  OrgRole,
  ProjectRole,
  type AuthResponse,
} from '@fieldreport/contracts';
import type { ServerDeps } from '../deps.js';
import { newId } from '../ids.js';
import { hash } from './passwords.js';
import { requireAuth } from './context.js';
import { makeAuthz } from './authz.js';
import { throttle } from './routes.js';
import { inviteEmail } from '../email/index.js';
import type { InvitationRow } from '../db/types.js';

/** Two weeks: long enough for construction-office latency, short enough to bound the
 *  window a lost token matters. Re-invite when it lapses. */
const INVITE_TTL_DAYS = 14;

const CreateInvitationBody = z.object({
  email: z.string().email().max(254),
  orgRole: OrgRole.default('member'),
  projectAssignments: z
    .array(z.object({ projectId: z.string().max(100), role: ProjectRole }))
    .max(50)
    .default([]),
});

export function registerInvitationRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { repo, sessions, config } = deps;
  const authz = makeAuthz(repo);

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
      const parsed = CreateInvitationBody.safeParse(req.body);
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
      const token = `inv_${randomBytes(32).toString('base64url')}`;
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
      try {
        const rendered = inviteEmail({
          orgName: org?.name ?? 'your organization',
          inviterName: req.auth!.user.name ?? 'An admin',
          acceptUrl: inviteUrl,
          orgRole: parsed.data.orgRole,
        });
        await deps.email.send({ to: { email: parsed.data.email }, ...rendered });
      } catch (err) {
        req.log.error({ err }, 'invite email failed (invitation still created)');
      }
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

  // ── Accept (unauthenticated; issues the session) ────────────────────────────
  app.post('/api/auth/invitations/accept', { preHandler: throttle }, async (req, reply) => {
    const parsed = AcceptInviteRequest.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid accept', issues: parsed.error.issues });
    }
    const r = await resolveInvitation(parsed.data.token);
    if (!r.ok) return reply.code(r.code).send({ error: r.error });
    const { inv } = r;

    // Create-or-update the user (idempotent-safe against an existing account).
    let user = await repo.getUserByEmail(inv.email);
    if (!user) {
      const id = newId('usr');
      await repo.createUser({
        id,
        email: inv.email,
        name: parsed.data.name,
        passwordHash: await hash(parsed.data.password),
      });
      user = await repo.getUserById(id);
    } else if (!user.passwordHash) {
      // Pending account (invited before, never activated): this IS the activation.
      await repo.updateUser(user.id, {
        name: parsed.data.name,
        passwordHash: await hash(parsed.data.password),
      });
      user = await repo.getUserById(user.id);
    }
    // else: active account — keep its credentials; the invite only adds membership.

    if (!(await repo.getMembership(user!.id, inv.orgId))) {
      await repo.addMembership({
        id: newId('mem'),
        userId: user!.id,
        orgId: inv.orgId,
        orgRole: inv.orgRole,
      });
    }
    for (const a of inv.projectAssignments) {
      // Re-validate org ownership (defense in depth vs rows minted by older code).
      if ((await repo.getProjectOrgId(a.projectId)) !== inv.orgId) continue;
      if (!(await repo.getProjectRole(a.projectId, user!.id))) {
        await repo.addProjectMember({
          id: newId('pm'),
          projectId: a.projectId,
          userId: user!.id,
          role: a.role,
        });
      }
    }
    await repo.markInvitationAccepted(inv.id);

    const token = await sessions.issue(user!.id);
    const body: AuthResponse = {
      token,
      user: { id: user!.id, email: user!.email, name: user!.name },
      orgs: await repo.listOrgsForUser(user!.id),
    };
    return body;
  });
}

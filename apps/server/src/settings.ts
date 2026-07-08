/**
 * Settings surfaces (Phase 10 / F2): org members & roles, project create/visibility, and
 * per-project member assignments — the endpoints behind /settings/members and
 * /settings/projects in the web app (the stakeholder directory endpoints live in
 * directory.ts since Phase 7).
 *
 * Guards follow the permission matrix: org-level membership ops are ORG-ADMIN only (with
 * a last-admin lockout guard so an org can never orphan itself); project-level member
 * assignments are canManageProject (admin|pm). Reads use 404-not-403 for existence
 * (project ids / org ids never leak); writes the caller can see but not perform get 403.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  UpdateMemberRoleRequest,
  CreateProjectRequest,
  UpdateProjectRequest,
  SetProjectMemberRequest,
  type OrgMemberRow,
} from '@fieldreport/contracts';
import type { ServerDeps } from './deps.js';
import { newId } from './ids.js';
import { requireAuth } from './auth/context.js';

export function registerSettingsRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { repo, authz } = deps;

  /** 404 (no leak) unless the caller is at least a member of :orgId. */
  const requireOrgMember = async (
    req: FastifyRequest<{ Params: { orgId: string } }>,
    reply: FastifyReply,
  ): Promise<boolean> => {
    if (!(await repo.getMembership(req.auth!.userId, req.params.orgId))) {
      await reply.code(404).send({ error: 'not found' });
      return false;
    }
    return true;
  };

  // ── Members & roles ──────────────────────────────────────────────────────────
  // Table read: org admins and PMs (design: /settings/members · Admin/PM). Supers/viewers
  // get 403 — the UI shows them the read-only banner instead of the table.
  app.get<{ Params: { orgId: string } }>(
    '/api/orgs/:orgId/members',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireOrgMember(req, reply))) return reply;
      const isAdmin = await authz.isOrgAdmin(req, req.params.orgId);
      if (!isAdmin) {
        const roles = await repo.listProjectRolesForUser(req.auth!.userId, req.params.orgId);
        if (!roles.some((r) => r.role === 'pm')) {
          return reply.code(403).send({ error: 'forbidden' });
        }
      }
      const [members, projs] = await Promise.all([
        repo.listOrgMembers(req.params.orgId),
        repo.listProjectsForOrg(req.params.orgId),
      ]);
      const names = new Map(projs.map((p) => [p.id, p.name]));
      const rows: OrgMemberRow[] = members.map((m) => ({
        user: { id: m.id, email: m.email, name: m.name ?? undefined },
        orgRole: m.orgRole,
        assignments: m.projects.map((pm) => ({
          projectId: pm.projectId,
          projectName: names.get(pm.projectId) ?? pm.projectId,
          role: pm.role,
        })),
      }));
      return rows;
    },
  );

  app.patch<{ Params: { orgId: string; userId: string } }>(
    '/api/orgs/:orgId/members/:userId',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireOrgMember(req, reply))) return reply;
      if (!(await authz.isOrgAdmin(req, req.params.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const target = await repo.getMembership(req.params.userId, req.params.orgId);
      if (!target) return reply.code(404).send({ error: 'not found' });
      const parsed = UpdateMemberRoleRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid role', issues: parsed.error.issues });
      }
      // Last-admin lockout guard: an org must always keep at least one admin. Enforced
      // ATOMICALLY in the repo (admin rows locked + counted in the same transaction as
      // the write) so two concurrent demotes can't race the org to zero admins.
      const result = await repo.updateMembershipRoleGuarded(
        req.params.userId,
        req.params.orgId,
        parsed.data.orgRole,
      );
      if (result === 'last-admin') {
        return reply.code(400).send({ error: 'an organization needs at least one admin' });
      }
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { orgId: string; userId: string } }>(
    '/api/orgs/:orgId/members/:userId',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireOrgMember(req, reply))) return reply;
      if (!(await authz.isOrgAdmin(req, req.params.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const target = await repo.getMembership(req.params.userId, req.params.orgId);
      if (!target) return reply.code(404).send({ error: 'not found' });
      // Atomic last-admin guard — see the PATCH handler above.
      const result = await repo.removeMembershipGuarded(req.params.userId, req.params.orgId);
      if (result === 'last-admin') {
        return reply.code(400).send({ error: 'an organization needs at least one admin' });
      }
      return reply.code(204).send();
    },
  );

  // ── Projects (create + visibility) ───────────────────────────────────────────
  app.post<{ Params: { orgId: string } }>(
    '/api/orgs/:orgId/projects',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireOrgMember(req, reply))) return reply;
      if (!(await authz.isOrgAdmin(req, req.params.orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const parsed = CreateProjectRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid project', issues: parsed.error.issues });
      }
      const id = newId('proj');
      await repo.createProject({
        id,
        orgId: req.params.orgId,
        name: parsed.data.name,
        // Legacy default-preparer label; real prep names come from sessions now (§6.1).
        superName: req.auth!.user.name ?? '',
        visibility: parsed.data.visibility,
      });
      const created = await repo.getProject(id);
      return reply.code(201).send({ ...created, role: null });
    },
  );

  app.patch<{ Params: { projectId: string } }>(
    '/api/projects/:projectId',
    { preHandler: requireAuth },
    async (req, reply) => {
      // 404-no-leak first, then visibility changes are org-admin only (design: Settings →
      // Projects is an Admin screen).
      if (!(await authz.canViewProject(req, req.params.projectId))) {
        return reply.code(404).send({ error: 'not found' });
      }
      const orgId = await repo.getProjectOrgId(req.params.projectId);
      if (!orgId || !(await authz.isOrgAdmin(req, orgId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const parsed = UpdateProjectRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid update', issues: parsed.error.issues });
      }
      await repo.setProjectVisibility(req.params.projectId, parsed.data.visibility);
      return reply.code(204).send();
    },
  );

  // ── Project member assignments ───────────────────────────────────────────────
  /** 404-no-leak read gate + canManageProject (admin|pm) write gate. */
  const requireProjectManager = async (
    req: FastifyRequest<{ Params: { projectId: string } }>,
    reply: FastifyReply,
  ): Promise<boolean> => {
    if (!(await authz.canViewProject(req, req.params.projectId))) {
      await reply.code(404).send({ error: 'not found' });
      return false;
    }
    if (!(await authz.canManageProject(req, req.params.projectId))) {
      await reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  };

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/members',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireProjectManager(req, reply))) return reply;
      return repo.listProjectMembers(req.params.projectId);
    },
  );

  app.put<{ Params: { projectId: string; userId: string } }>(
    '/api/projects/:projectId/members/:userId',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireProjectManager(req, reply))) return reply;
      const parsed = SetProjectMemberRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid role', issues: parsed.error.issues });
      }
      // The assignee must belong to the project's org — assignments never cross tenants.
      const orgId = await repo.getProjectOrgId(req.params.projectId);
      if (!orgId || !(await repo.getMembership(req.params.userId, orgId))) {
        return reply.code(400).send({ error: 'user is not a member of this organization' });
      }
      await repo.setProjectMemberRole({
        id: newId('pmr'),
        projectId: req.params.projectId,
        userId: req.params.userId,
        role: parsed.data.role,
      });
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { projectId: string; userId: string } }>(
    '/api/projects/:projectId/members/:userId',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireProjectManager(req, reply))) return reply;
      await repo.removeProjectMember(req.params.projectId, req.params.userId);
      return reply.code(204).send();
    },
  );
}

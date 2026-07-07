/**
 * Stakeholder directory + project roster + distribution defaults (auth plan §7, Phase 7).
 *
 * Directory (stakeholder orgs + their contacts) lives at ORG level and is managed by org
 * admins; every :sid/:cid is re-checked to belong to :orgId so an admin of one org can
 * never touch another's directory. The per-project ROSTER (a subset of the directory) and
 * the remembered distribution DEFAULT are managed by the project's pm (or an org admin);
 * send-capable roles (admin/pm/super) may read them to seed the Send modal.
 *
 * Deleting a stakeholder org/contact never orphans past deliveries: report_send_recipients
 * keep their denormalized email/name and their contact_id goes SET NULL (§1.2).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CreateStakeholderOrgRequest,
  UpdateStakeholderOrgRequest,
  CreateStakeholderContactRequest,
  UpdateStakeholderContactRequest,
  SetProjectRosterRequest,
  SendSelection,
} from '@fieldreport/contracts';
import type { ServerDeps } from './deps.js';
import { newId, normalizeEmail } from './ids.js';
import { requireAuth } from './auth/context.js';

export function registerDirectoryRoutes(app: FastifyInstance, deps: ServerDeps): void {
  const { repo, authz } = deps;

  /** Org-admin gate for a directory route; 403 when the caller isn't an admin of :orgId. */
  const requireOrgAdmin = async (
    req: FastifyRequest<{ Params: { orgId: string } }>,
    reply: FastifyReply,
  ): Promise<boolean> => {
    if (!(await authz.isOrgAdmin(req, req.params.orgId))) {
      await reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  };

  // ── Directory: stakeholder orgs ─────────────────────────────────────────────
  app.get<{ Params: { orgId: string } }>(
    '/api/orgs/:orgId/stakeholders',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireOrgAdmin(req, reply))) return reply;
      return repo.listStakeholderOrgs(req.params.orgId);
    },
  );

  app.post<{ Params: { orgId: string } }>(
    '/api/orgs/:orgId/stakeholders',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireOrgAdmin(req, reply))) return reply;
      const parsed = CreateStakeholderOrgRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid stakeholder org', issues: parsed.error.issues });
      }
      const id = newId('sto');
      await repo.createStakeholderOrg({ id, orgId: req.params.orgId, name: parsed.data.name, kind: parsed.data.kind });
      return reply.code(201).send({ id, name: parsed.data.name, kind: parsed.data.kind, contacts: [] });
    },
  );

  app.patch<{ Params: { orgId: string; sid: string } }>(
    '/api/orgs/:orgId/stakeholders/:sid',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireOrgAdmin(req, reply))) return reply;
      if ((await repo.getStakeholderOrgOrgId(req.params.sid)) !== req.params.orgId) {
        return reply.code(404).send({ error: 'not found' });
      }
      const parsed = UpdateStakeholderOrgRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid update', issues: parsed.error.issues });
      }
      await repo.updateStakeholderOrg(req.params.sid, parsed.data);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { orgId: string; sid: string } }>(
    '/api/orgs/:orgId/stakeholders/:sid',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireOrgAdmin(req, reply))) return reply;
      if ((await repo.getStakeholderOrgOrgId(req.params.sid)) !== req.params.orgId) {
        return reply.code(404).send({ error: 'not found' });
      }
      await repo.deleteStakeholderOrg(req.params.sid);
      return reply.code(204).send();
    },
  );

  // ── Directory: contacts (nested under a stakeholder org) ─────────────────────
  app.post<{ Params: { orgId: string; sid: string } }>(
    '/api/orgs/:orgId/stakeholders/:sid/contacts',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireOrgAdmin(req, reply))) return reply;
      if ((await repo.getStakeholderOrgOrgId(req.params.sid)) !== req.params.orgId) {
        return reply.code(404).send({ error: 'not found' });
      }
      const parsed = CreateStakeholderContactRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid contact', issues: parsed.error.issues });
      }
      const id = newId('stc');
      await repo.createStakeholderContact({
        id,
        stakeholderOrgId: req.params.sid,
        name: parsed.data.name,
        email: parsed.data.email,
        title: parsed.data.title,
      });
      return reply
        .code(201)
        .send({ id, name: parsed.data.name, email: normalizeEmail(parsed.data.email), title: parsed.data.title });
    },
  );

  app.patch<{ Params: { orgId: string; sid: string; cid: string } }>(
    '/api/orgs/:orgId/stakeholders/:sid/contacts/:cid',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireOrgAdmin(req, reply))) return reply;
      if ((await repo.getStakeholderContactOrgId(req.params.cid)) !== req.params.orgId) {
        return reply.code(404).send({ error: 'not found' });
      }
      const parsed = UpdateStakeholderContactRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid update', issues: parsed.error.issues });
      }
      await repo.updateStakeholderContact(req.params.cid, parsed.data);
      return reply.code(204).send();
    },
  );

  app.delete<{ Params: { orgId: string; sid: string; cid: string } }>(
    '/api/orgs/:orgId/stakeholders/:sid/contacts/:cid',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireOrgAdmin(req, reply))) return reply;
      if ((await repo.getStakeholderContactOrgId(req.params.cid)) !== req.params.orgId) {
        return reply.code(404).send({ error: 'not found' });
      }
      await repo.deleteStakeholderContact(req.params.cid);
      return reply.code(204).send();
    },
  );

  // ── Project roster + distribution default ────────────────────────────────────
  // Reads are open to send-capable roles (admin/pm/super) to seed the Send modal; roster
  // WRITES are pm/admin (§5.1). 404 (not 403) when the caller can't even send, so project
  // ids don't leak.
  const requireSendCapable = async (
    req: FastifyRequest<{ Params: { projectId: string } }>,
    reply: FastifyReply,
  ): Promise<boolean> => {
    if (!(await authz.canCapture(req, req.params.projectId))) {
      await reply.code(404).send({ error: 'not found' });
      return false;
    }
    return true;
  };

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/stakeholders',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireSendCapable(req, reply))) return reply;
      return repo.listProjectStakeholders(req.params.projectId);
    },
  );

  app.put<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/stakeholders',
    { preHandler: requireAuth },
    async (req, reply) => {
      // Read-gate first (404 no-leak), then the stricter manage-gate (403) for the write.
      if (!(await requireSendCapable(req, reply))) return reply;
      if (!(await authz.canManageProject(req, req.params.projectId))) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const parsed = SetProjectRosterRequest.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid roster', issues: parsed.error.issues });
      }
      // Every roster entry must be a stakeholder org of THIS project's tenant org — a pm
      // must not attach another org's directory entries via a crafted id.
      const projectOrgId = await repo.getProjectOrgId(req.params.projectId);
      for (const sid of parsed.data.stakeholderOrgIds) {
        if ((await repo.getStakeholderOrgOrgId(sid)) !== projectOrgId) {
          return reply.code(400).send({ error: `stakeholder ${sid} does not belong to this org` });
        }
      }
      await repo.setProjectStakeholders(req.params.projectId, parsed.data.stakeholderOrgIds);
      return repo.listProjectStakeholders(req.params.projectId);
    },
  );

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/distribution-default',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireSendCapable(req, reply))) return reply;
      return repo.getDistributionDefault(req.params.projectId);
    },
  );

  app.put<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/distribution-default',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (!(await requireSendCapable(req, reply))) return reply;
      const parsed = SendSelection.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid selection', issues: parsed.error.issues });
      }
      await repo.setDistributionDefault(req.params.projectId, parsed.data);
      return parsed.data;
    },
  );
}

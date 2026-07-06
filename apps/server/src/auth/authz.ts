/**
 * Authorization helpers (auth plan §5). Pure predicate functions over req.auth + the
 * repo; routes decide the HTTP response (401/403/404 — reads use 404 to avoid leaking
 * existence, §6.3). Lookups are cached per request: one report view resolves
 * project → org → membership → role once, not once per predicate.
 *
 * Capability matrix (§5.1): org admin can do everything in their org; pm edits and
 * finalizes ANY report on the project (D-6); super edits/finalizes their OWN (createdBy);
 * viewer sees finalized only; org members see finalized only on visibility='org'
 * projects; everyone else sees nothing. Anyone who can finalize can send (D-7).
 */
import type { FastifyRequest } from 'fastify';
import type { OrgRole, ProjectRole, Report } from '@fieldreport/contracts';
import type { Repo } from '../db/types.js';

export interface ProjectAccess {
  /** The project's org (null = unknown project or pre-adoption row). */
  orgId: string | null;
  /** Caller's org-level role, null when not a member of the project's org. */
  orgRole: OrgRole | null;
  /** Caller's project-level role, null when unassigned. */
  projectRole: ProjectRole | null;
  visibility: 'org' | 'assigned';
}

export interface Authz {
  /** Org-level admin check (settings, directory, invitations). */
  isOrgAdmin(req: FastifyRequest, orgId: string): Promise<boolean>;
  /** Resolve the caller's standing on a project (cached per request). */
  projectAccess(req: FastifyRequest, projectId: string): Promise<ProjectAccess>;
  /** Capture/upload to the project: org admin, pm, or super (§5.1 row 1). */
  canCapture(req: FastifyRequest, projectId: string): Promise<boolean>;
  /** See the project at all (list endpoint gate): any org member or project role. */
  canViewProject(req: FastifyRequest, projectId: string): Promise<boolean>;
  /** See THIS report: draft visibility is role-gated, org-wide visibility needs
   *  status='reviewed' (§5.1 view rows). */
  canViewReport(req: FastifyRequest, report: Report): Promise<boolean>;
  /** Edit: admin, pm, or the authoring super (D-6). */
  canEditReport(req: FastifyRequest, report: Report): Promise<boolean>;
  /** Finalize = edit; send = finalize (D-7). */
  canFinalize(req: FastifyRequest, report: Report): Promise<boolean>;
  canSend(req: FastifyRequest, report: Report): Promise<boolean>;
  /** Org ids where the caller is admin (admin surface scoping, §6.8). */
  adminOrgIds(req: FastifyRequest): Promise<string[]>;
}

/** Per-request lookup cache, keyed off the request object itself. */
const caches = new WeakMap<FastifyRequest, Map<string, unknown>>();
async function cached<T>(req: FastifyRequest, key: string, load: () => Promise<T>): Promise<T> {
  let m = caches.get(req);
  if (!m) caches.set(req, (m = new Map()));
  if (!m.has(key)) m.set(key, await load());
  return m.get(key) as T;
}

export function makeAuthz(repo: Repo): Authz {
  async function projectAccess(req: FastifyRequest, projectId: string): Promise<ProjectAccess> {
    return cached(req, `pa:${projectId}`, async (): Promise<ProjectAccess> => {
      const none: ProjectAccess = { orgId: null, orgRole: null, projectRole: null, visibility: 'assigned' };
      if (!req.auth) return none;
      const project = await repo.getProject(projectId);
      if (!project?.orgId) return none; // unknown or unadopted → no tenancy → no access
      const membership = await repo.getMembership(req.auth.userId, project.orgId);
      if (!membership) return { ...none, orgId: project.orgId };
      const projectRole = await repo.getProjectRole(projectId, req.auth.userId);
      return {
        orgId: project.orgId,
        orgRole: membership.orgRole,
        projectRole,
        visibility: project.visibility ?? 'assigned',
      };
    });
  }

  async function canEditReport(req: FastifyRequest, report: Report): Promise<boolean> {
    const a = await projectAccess(req, report.projectId);
    if (a.orgRole === 'admin') return true;
    if (a.projectRole === 'pm') return true;
    if (a.projectRole === 'super') return report.createdBy === req.auth?.userId;
    return false;
  }

  return {
    projectAccess,

    async isOrgAdmin(req, orgId) {
      if (!req.auth) return false;
      const m = await cached(req, `mem:${orgId}`, () =>
        repo.getMembership(req.auth!.userId, orgId),
      );
      return m?.orgRole === 'admin';
    },

    async canCapture(req, projectId) {
      const a = await projectAccess(req, projectId);
      return a.orgRole === 'admin' || a.projectRole === 'pm' || a.projectRole === 'super';
    },

    async canViewProject(req, projectId) {
      const a = await projectAccess(req, projectId);
      if (a.orgRole === 'admin' || a.projectRole) return true;
      // Org member with no assignment sees the project only when it's org-visible.
      return a.orgRole != null && a.visibility === 'org';
    },

    async canViewReport(req, report) {
      const a = await projectAccess(req, report.projectId);
      if (a.orgRole === 'admin') return true;
      if (a.projectRole === 'pm' || a.projectRole === 'super') return true;
      if (a.projectRole === 'viewer') return report.status === 'reviewed';
      // No project role: org members see finalized reports on org-visible projects.
      return a.orgRole != null && a.visibility === 'org' && report.status === 'reviewed';
    },

    canEditReport,
    canFinalize: canEditReport, // finalize = edit (D-6)
    canSend: canEditReport, // anyone who can finalize can send (D-7)

    async adminOrgIds(req) {
      if (!req.auth) return [];
      return cached(req, 'adminOrgs', async () =>
        (await repo.listOrgsForUser(req.auth!.userId))
          .filter((o) => o.role === 'admin')
          .map((o) => o.id),
      );
    },
  };
}

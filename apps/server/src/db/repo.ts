/**
 * Repository — the only place SQL lives. Speaks CONTRACT types to callers; maps Drizzle
 * rows in/out. Upload is idempotent on walkId (a retried upload returns the existing
 * report rather than duplicating). Implements the Repo interface in db/types.ts.
 */
import { eq, and, asc, desc, inArray, sql } from 'drizzle-orm';
import type {
  Report,
  ReportEdit,
  ProcessingStatus,
  Project,
  UploadManifest,
  ProjectMember,
  StakeholderOrg,
  ReportSend,
} from '@fieldreport/contracts';
import type { SynthesisOutput } from '../synthesis/types.js';
import type { Db } from './client.js';
import type { IngestMediaKeys, ProcessingObservation, Repo } from './types.js';
import { reportIdForWalk, newId } from '../ids.js';
import {
  projects,
  reports,
  observations,
  photos,
  orgs,
  users,
  sessions,
  memberships,
  invitations,
  projectMembers,
  stakeholderOrgs,
  stakeholderContacts,
  projectStakeholders,
  projectDistributionDefaults,
  reportSends,
  reportSendRecipients,
  type ProjectRow,
  type StakeholderOrgRow,
  type StakeholderContactRow,
} from './schema.js';

const iso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

/** Emails are normalized lowercase at this layer (unique index is on lower(email)). */
const normEmail = (email: string): string => email.trim().toLowerCase();

const mapProject = (p: ProjectRow): Project => ({
  id: p.id,
  name: p.name,
  superName: p.superName,
  glossary: p.glossary ?? [],
  baseLexiconRef: p.baseLexiconRef,
  orgId: p.orgId ?? undefined,
  visibility: p.visibility,
});

/** Assemble StakeholderOrg[] (contract shape, contacts nested) from row sets. */
const mapStakeholderOrgs = (
  sos: StakeholderOrgRow[],
  contacts: StakeholderContactRow[],
): StakeholderOrg[] => {
  const byOrg = new Map<string, StakeholderContactRow[]>();
  for (const c of contacts) {
    const list = byOrg.get(c.stakeholderOrgId) ?? [];
    list.push(c);
    byOrg.set(c.stakeholderOrgId, list);
  }
  return sos.map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.kind,
    contacts: (byOrg.get(s.id) ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      title: c.title ?? undefined,
    })),
  }));
};

export function makeRepo(db: Db): Repo {
  async function assembleReport(id: string): Promise<Report | null> {
    const r = (await db.select().from(reports).where(eq(reports.id, id)).limit(1))[0];
    if (!r) return null;
    const proj = (
      await db.select({ name: projects.name }).from(projects).where(eq(projects.id, r.projectId)).limit(1)
    )[0];

    const obsRows = await db
      .select()
      .from(observations)
      .where(eq(observations.reportId, id))
      .orderBy(asc(observations.ord));

    const obsIds = obsRows.map((o) => o.id);
    const photoRows = obsIds.length
      ? await db.select().from(photos).where(inArray(photos.observationId, obsIds)).orderBy(asc(photos.ord))
      : [];

    const photosByObs = new Map<string, typeof photoRows>();
    for (const p of photoRows) {
      const list = photosByObs.get(p.observationId) ?? [];
      list.push(p);
      photosByObs.set(p.observationId, list);
    }

    const obs = obsRows.map((o) => ({
      id: o.id,
      order: o.ord,
      createdAt: iso(o.createdAt),
      photos: (photosByObs.get(o.id) ?? []).map((p) => ({
        id: p.id,
        blobRef: p.storageKey,
        width: p.width,
        height: p.height,
        byteSize: p.byteSize ?? undefined,
      })),
      annotations: o.annotations ?? undefined,
      audioRef: o.audioKey ?? '',
      transcript: o.transcript ?? undefined,
      cleanedDescription: o.cleanedDescription ?? undefined,
      trade: o.trade ?? undefined,
      area: o.area ?? undefined,
    }));

    return {
      id: r.id,
      projectId: r.projectId,
      projectName: proj?.name ?? undefined,
      date: r.date,
      superName: r.superName,
      summary: r.summary,
      observations: obs,
      status: r.status,
      processing: r.processing,
      processingError: r.processingError ?? undefined,
      createdBy: r.createdBy ?? undefined,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    };
  }

  return {
    async getProject(id) {
      const p = (await db.select().from(projects).where(eq(projects.id, id)).limit(1))[0];
      if (!p) return null;
      return mapProject(p);
    },

    async upsertProject(p: Project) {
      await db
        .insert(projects)
        .values({
          id: p.id,
          name: p.name,
          superName: p.superName,
          glossary: p.glossary,
          baseLexiconRef: p.baseLexiconRef,
        })
        .onConflictDoUpdate({
          target: projects.id,
          set: { name: p.name, superName: p.superName, glossary: p.glossary, baseLexiconRef: p.baseLexiconRef },
        });
    },

    async ensureProjectFromUpload(p) {
      // Insert with the column defaults (empty glossary, base lexicon ref). On conflict,
      // only refresh the human fields — the glossary is curated/accumulated and must survive.
      await db
        .insert(projects)
        .values({ id: p.id, name: p.name, superName: p.superName })
        .onConflictDoUpdate({
          target: projects.id,
          set: { name: p.name, superName: p.superName },
        });
    },

    async createReportFromUpload(manifest: UploadManifest, media: IngestMediaKeys) {
      const reportId = reportIdForWalk(manifest.walkId);
      return db.transaction(async (tx) => {
        const existing = (
          await tx.select({ id: reports.id }).from(reports).where(eq(reports.walkId, manifest.walkId)).limit(1)
        )[0];
        if (existing) {
          const obs = await tx
            .select({ id: observations.id })
            .from(observations)
            .where(eq(observations.reportId, existing.id));
          return { reportId: existing.id, created: false, acceptedObservationIds: obs.map((o) => o.id) };
        }

        await tx.insert(reports).values({
          id: reportId,
          projectId: manifest.projectId,
          walkId: manifest.walkId,
          date: manifest.date,
          superName: manifest.superName,
          processing: 'uploaded',
          status: 'draft',
        });

        for (const o of manifest.observations) {
          await tx.insert(observations).values({
            id: o.id,
            reportId,
            ord: o.order,
            createdAt: new Date(o.createdAt),
            audioKey: media.audio[o.id]?.key ?? null,
            audioMime: media.audio[o.id]?.mime ?? null,
            annotations: o.annotations ?? null,
          });
          let pord = 0;
          for (const ph of o.photos) {
            const m = media.photos[ph.id];
            if (!m) continue;
            await tx.insert(photos).values({
              id: ph.id,
              observationId: o.id,
              storageKey: m.key,
              width: m.width,
              height: m.height,
              byteSize: m.byteSize,
              ord: pord++,
            });
          }
        }

        return {
          reportId,
          created: true,
          acceptedObservationIds: manifest.observations.map((o) => o.id),
        };
      });
    },

    getReport: assembleReport,

    async getReportStatus(id) {
      const r = (
        await db
          .select({ status: reports.status, processing: reports.processing, error: reports.processingError })
          .from(reports)
          .where(eq(reports.id, id))
          .limit(1)
      )[0];
      if (!r) return null;
      return { status: r.status, processing: r.processing, error: r.error ?? undefined };
    },

    async listReports() {
      const rows = await db.select({ id: reports.id }).from(reports).orderBy(desc(reports.createdAt));
      const out: Report[] = [];
      for (const row of rows) {
        const r = await assembleReport(row.id);
        if (r) out.push(r);
      }
      return out;
    },

    async getProcessingObservations(reportId): Promise<ProcessingObservation[]> {
      const obs = await db
        .select({
          id: observations.id,
          ord: observations.ord,
          audioKey: observations.audioKey,
          audioMime: observations.audioMime,
        })
        .from(observations)
        .where(eq(observations.reportId, reportId))
        .orderBy(asc(observations.ord));
      if (!obs.length) return [];
      const counts = await db
        .select({ oid: photos.observationId, c: sql<number>`count(*)::int` })
        .from(photos)
        .where(inArray(photos.observationId, obs.map((o) => o.id)))
        .groupBy(photos.observationId);
      const cmap = new Map(counts.map((c) => [c.oid, Number(c.c)]));
      return obs.map((o) => ({
        id: o.id,
        order: o.ord,
        audioKey: o.audioKey ?? null,
        audioMime: o.audioMime ?? null,
        photoCount: cmap.get(o.id) ?? 0,
      }));
    },

    async getReportProjectId(id) {
      const r = (
        await db.select({ pid: reports.projectId }).from(reports).where(eq(reports.id, id)).limit(1)
      )[0];
      return r?.pid ?? null;
    },

    async setProcessing(id, status: ProcessingStatus, error) {
      await db
        .update(reports)
        .set({ processing: status, processingError: error ?? null, updatedAt: new Date() })
        .where(eq(reports.id, id));
    },

    async setTranscript(observationId, text, confidence) {
      await db
        .update(observations)
        .set({ transcript: text, transcriptConfidence: confidence ?? null })
        .where(eq(observations.id, observationId));
    },

    async applySynthesis(reportId, out: SynthesisOutput) {
      await db.transaction(async (tx) => {
        // Write both the live summary AND the immutable AI-draft snapshot. Edits change
        // `summary`; `ai_summary` stays the original so we can measure how much was changed.
        await tx
          .update(reports)
          .set({ summary: out.summary, aiSummary: out.summary, updatedAt: new Date() })
          .where(eq(reports.id, reportId));
        for (const o of out.observations) {
          await tx
            .update(observations)
            .set({
              cleanedDescription: o.cleanedDescription,
              aiCleanedDescription: o.cleanedDescription,
              trade: o.trade ?? null,
              area: o.area ?? null,
            })
            .where(and(eq(observations.id, o.id), eq(observations.reportId, reportId)));
        }
      });
    },

    async setRenderArtifacts(id, keys) {
      await db
        .update(reports)
        .set({ htmlKey: keys.htmlKey, pdfKey: keys.pdfKey, updatedAt: new Date() })
        .where(eq(reports.id, id));
    },

    async applyEdit(id, edit: ReportEdit) {
      const exists = (await db.select({ id: reports.id }).from(reports).where(eq(reports.id, id)).limit(1))[0];
      if (!exists) return null;
      await db.transaction(async (tx) => {
        if (edit.summary !== undefined) {
          await tx.update(reports).set({ summary: edit.summary }).where(eq(reports.id, id));
        }
        for (const o of edit.observations ?? []) {
          const set: Partial<{ cleanedDescription: string; trade: string; area: string }> = {};
          if (o.cleanedDescription !== undefined) set.cleanedDescription = o.cleanedDescription;
          if (o.trade !== undefined) set.trade = o.trade;
          if (o.area !== undefined) set.area = o.area;
          if (Object.keys(set).length) {
            await tx.update(observations).set(set).where(and(eq(observations.id, o.id), eq(observations.reportId, id)));
          }
        }
        // An edit reverts the report to draft until it is re-finalized (review gate).
        await tx.update(reports).set({ status: 'draft', updatedAt: new Date() }).where(eq(reports.id, id));
      });
      return assembleReport(id);
    },

    async finalize(id) {
      const exists = (await db.select({ id: reports.id }).from(reports).where(eq(reports.id, id)).limit(1))[0];
      if (!exists) return null;
      await db.update(reports).set({ status: 'reviewed', updatedAt: new Date() }).where(eq(reports.id, id));
      return assembleReport(id);
    },

    async setLangsmithRunId(id, runId) {
      await db.update(reports).set({ langsmithRunId: runId }).where(eq(reports.id, id));
    },

    async getReportQuality(id) {
      const r = (
        await db
          .select({
            id: reports.id,
            runId: reports.langsmithRunId,
            status: reports.status,
            processing: reports.processing,
            createdAt: reports.createdAt,
            summary: reports.summary,
            aiSummary: reports.aiSummary,
          })
          .from(reports)
          .where(eq(reports.id, id))
          .limit(1)
      )[0];
      if (!r) return null;
      const obs = await db
        .select({
          id: observations.id,
          cleanedDescription: observations.cleanedDescription,
          aiCleanedDescription: observations.aiCleanedDescription,
          transcriptConfidence: observations.transcriptConfidence,
        })
        .from(observations)
        .where(eq(observations.reportId, id))
        .orderBy(asc(observations.ord));
      return {
        id: r.id,
        runId: r.runId ?? null,
        status: r.status,
        processing: r.processing,
        createdAt: iso(r.createdAt),
        summary: r.summary,
        aiSummary: r.aiSummary ?? null,
        observations: obs.map((o) => ({
          id: o.id,
          cleanedDescription: o.cleanedDescription ?? null,
          aiCleanedDescription: o.aiCleanedDescription ?? null,
          transcriptConfidence: o.transcriptConfidence ?? null,
        })),
      };
    },

    async listReportQuality() {
      const rs = await db
        .select({
          id: reports.id,
          runId: reports.langsmithRunId,
          status: reports.status,
          processing: reports.processing,
          createdAt: reports.createdAt,
          summary: reports.summary,
          aiSummary: reports.aiSummary,
        })
        .from(reports)
        .orderBy(desc(reports.createdAt));
      if (!rs.length) return [];
      const allObs = await db
        .select({
          reportId: observations.reportId,
          id: observations.id,
          ord: observations.ord,
          cleanedDescription: observations.cleanedDescription,
          aiCleanedDescription: observations.aiCleanedDescription,
          transcriptConfidence: observations.transcriptConfidence,
        })
        .from(observations)
        .orderBy(asc(observations.ord));
      const byReport = new Map<string, typeof allObs>();
      for (const o of allObs) {
        const list = byReport.get(o.reportId) ?? [];
        list.push(o);
        byReport.set(o.reportId, list);
      }
      return rs.map((r) => ({
        id: r.id,
        runId: r.runId ?? null,
        status: r.status,
        processing: r.processing,
        createdAt: iso(r.createdAt),
        summary: r.summary,
        aiSummary: r.aiSummary ?? null,
        observations: (byReport.get(r.id) ?? []).map((o) => ({
          id: o.id,
          cleanedDescription: o.cleanedDescription ?? null,
          aiCleanedDescription: o.aiCleanedDescription ?? null,
          transcriptConfidence: o.transcriptConfidence ?? null,
        })),
      }));
    },

    // --- auth + multi-tenancy + distribution (AUTH_MULTITENANCY_PLAN.md §3) ---

    // identity

    async createUser(u) {
      await db.insert(users).values({
        id: u.id,
        email: normEmail(u.email),
        name: u.name,
        passwordHash: u.passwordHash ?? null,
      });
    },

    async getUserByEmail(email) {
      const r = (
        await db
          .select()
          .from(users)
          .where(sql`lower(${users.email}) = ${normEmail(email)}`)
          .limit(1)
      )[0];
      return r ?? null;
    },

    async getUserById(id) {
      const r = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
      return r ?? null;
    },

    async setUserPassword(id, passwordHash) {
      await db.update(users).set({ passwordHash }).where(eq(users.id, id));
    },

    // sessions

    async createSession(s) {
      await db.insert(sessions).values({ id: s.id, userId: s.userId, expiresAt: s.expiresAt });
    },

    async getSession(token) {
      const r = (
        await db
          .select({
            userId: sessions.userId,
            expiresAt: sessions.expiresAt,
            revokedAt: sessions.revokedAt,
          })
          .from(sessions)
          .where(eq(sessions.id, token))
          .limit(1)
      )[0];
      if (!r) return null;
      return { userId: r.userId, expiresAt: r.expiresAt ?? null, revokedAt: r.revokedAt ?? null };
    },

    async touchSession(token) {
      await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, token));
    },

    async revokeSession(token) {
      // COALESCE keeps the first revocation time if revoke is called twice.
      await db
        .update(sessions)
        .set({ revokedAt: sql`COALESCE(${sessions.revokedAt}, now())` })
        .where(eq(sessions.id, token));
    },

    // orgs + memberships

    async createOrg(o) {
      await db.insert(orgs).values({ id: o.id, name: o.name });
    },

    async getOrg(id) {
      const r = (await db.select().from(orgs).where(eq(orgs.id, id)).limit(1))[0];
      return r ? { id: r.id, name: r.name } : null;
    },

    async addMembership(m) {
      await db
        .insert(memberships)
        .values({ id: m.id, userId: m.userId, orgId: m.orgId, orgRole: m.orgRole });
    },

    async getMembership(userId, orgId) {
      const r = (
        await db
          .select({ orgRole: memberships.orgRole })
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
          .limit(1)
      )[0];
      return r ?? null;
    },

    async listOrgsForUser(userId) {
      return db
        .select({ id: orgs.id, name: orgs.name, role: memberships.orgRole })
        .from(memberships)
        .innerJoin(orgs, eq(memberships.orgId, orgs.id))
        .where(eq(memberships.userId, userId))
        .orderBy(asc(orgs.name));
    },

    async listOrgMembers(orgId) {
      const mrows = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          orgRole: memberships.orgRole,
        })
        .from(memberships)
        .innerJoin(users, eq(memberships.userId, users.id))
        .where(eq(memberships.orgId, orgId))
        .orderBy(asc(users.name));
      if (!mrows.length) return [];
      const pmRows = await db
        .select({
          projectId: projectMembers.projectId,
          userId: projectMembers.userId,
          role: projectMembers.projectRole,
        })
        .from(projectMembers)
        .innerJoin(projects, eq(projectMembers.projectId, projects.id))
        .where(
          and(
            eq(projects.orgId, orgId),
            inArray(projectMembers.userId, mrows.map((m) => m.id)),
          ),
        );
      const byUser = new Map<string, ProjectMember[]>();
      for (const pm of pmRows) {
        const list = byUser.get(pm.userId) ?? [];
        list.push({ projectId: pm.projectId, userId: pm.userId, role: pm.role });
        byUser.set(pm.userId, list);
      }
      return mrows.map((m) => ({
        id: m.id,
        email: m.email,
        name: m.name,
        orgRole: m.orgRole,
        projects: byUser.get(m.id) ?? [],
      }));
    },

    // invitations

    async createInvitation(i) {
      await db.insert(invitations).values({
        id: i.id,
        orgId: i.orgId,
        email: normEmail(i.email),
        orgRole: i.orgRole,
        projectAssignments: i.projectAssignments,
        token: i.token,
        invitedBy: i.invitedBy,
        expiresAt: i.expiresAt,
      });
    },

    async getInvitationByToken(token) {
      const r = (
        await db.select().from(invitations).where(eq(invitations.token, token)).limit(1)
      )[0];
      return r ?? null;
    },

    async markInvitationAccepted(id) {
      await db
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, id));
    },

    // projects (tenancy-aware)

    async listProjectsForUser(userId, orgId) {
      const mem = (
        await db
          .select({ orgRole: memberships.orgRole })
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)))
          .limit(1)
      )[0];
      if (!mem) return [];
      const projRows = await db
        .select()
        .from(projects)
        .where(eq(projects.orgId, orgId))
        .orderBy(asc(projects.name));
      if (mem.orgRole === 'admin') return projRows.map(mapProject);
      const pmRows = await db
        .select({ projectId: projectMembers.projectId })
        .from(projectMembers)
        .where(eq(projectMembers.userId, userId));
      const memberOf = new Set(pmRows.map((r) => r.projectId));
      return projRows
        .filter((p) => memberOf.has(p.id) || p.visibility === 'org')
        .map(mapProject);
    },

    async createProject(p) {
      await db.insert(projects).values({
        id: p.id,
        orgId: p.orgId,
        name: p.name,
        superName: p.superName,
        visibility: p.visibility,
      });
    },

    async setProjectVisibility(id, v) {
      await db.update(projects).set({ visibility: v }).where(eq(projects.id, id));
    },

    async getProjectOrgId(projectId) {
      const r = (
        await db
          .select({ orgId: projects.orgId })
          .from(projects)
          .where(eq(projects.id, projectId))
          .limit(1)
      )[0];
      return r?.orgId ?? null;
    },

    async addProjectMember(pm) {
      await db.insert(projectMembers).values({
        id: pm.id,
        projectId: pm.projectId,
        userId: pm.userId,
        projectRole: pm.role,
      });
    },

    async removeProjectMember(projectId, userId) {
      await db
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    },

    async listProjectMembers(projectId) {
      const rows = await db
        .select({
          projectId: projectMembers.projectId,
          userId: projectMembers.userId,
          role: projectMembers.projectRole,
          uid: users.id,
          uemail: users.email,
          uname: users.name,
        })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(eq(projectMembers.projectId, projectId))
        .orderBy(asc(users.name));
      return rows.map((r) => ({
        projectId: r.projectId,
        userId: r.userId,
        role: r.role,
        user: { id: r.uid, email: r.uemail, name: r.uname },
      }));
    },

    async getProjectRole(projectId, userId) {
      const r = (
        await db
          .select({ role: projectMembers.projectRole })
          .from(projectMembers)
          .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
          .limit(1)
      )[0];
      return r?.role ?? null;
    },

    // reports (scoping)

    async listReportsForProject(projectId) {
      const rows = await db
        .select({ id: reports.id })
        .from(reports)
        .where(eq(reports.projectId, projectId))
        .orderBy(desc(reports.createdAt));
      const out: Report[] = [];
      for (const row of rows) {
        const r = await assembleReport(row.id);
        if (r) out.push(r);
      }
      return out;
    },

    async setReportCreatedBy(reportId, userId) {
      await db.update(reports).set({ createdBy: userId }).where(eq(reports.id, reportId));
    },

    // stakeholder directory

    async listStakeholderOrgs(orgId) {
      const sos = await db
        .select()
        .from(stakeholderOrgs)
        .where(eq(stakeholderOrgs.orgId, orgId))
        .orderBy(asc(stakeholderOrgs.name));
      if (!sos.length) return [];
      const contacts = await db
        .select()
        .from(stakeholderContacts)
        .where(inArray(stakeholderContacts.stakeholderOrgId, sos.map((s) => s.id)))
        .orderBy(asc(stakeholderContacts.name));
      return mapStakeholderOrgs(sos, contacts);
    },

    async createStakeholderOrg(s) {
      await db
        .insert(stakeholderOrgs)
        .values({ id: s.id, orgId: s.orgId, name: s.name, kind: s.kind });
    },

    async updateStakeholderOrg(id, patch) {
      const set: Partial<{ name: string; kind: (typeof stakeholderOrgs.$inferSelect)['kind'] }> =
        {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.kind !== undefined) set.kind = patch.kind;
      if (Object.keys(set).length) {
        await db.update(stakeholderOrgs).set(set).where(eq(stakeholderOrgs.id, id));
      }
    },

    async deleteStakeholderOrg(id) {
      // Contacts cascade; past send recipients keep their denormalized email/name
      // (contact_id goes SET NULL) so the delivery audit survives directory edits.
      await db.delete(stakeholderOrgs).where(eq(stakeholderOrgs.id, id));
    },

    async createStakeholderContact(c) {
      await db.insert(stakeholderContacts).values({
        id: c.id,
        stakeholderOrgId: c.stakeholderOrgId,
        name: c.name,
        email: normEmail(c.email),
        title: c.title ?? null,
      });
    },

    async updateStakeholderContact(id, patch) {
      const set: Partial<{ name: string; email: string; title: string | null }> = {};
      if (patch.name !== undefined) set.name = patch.name;
      if (patch.email !== undefined) set.email = normEmail(patch.email);
      if (patch.title !== undefined) set.title = patch.title;
      if (Object.keys(set).length) {
        await db.update(stakeholderContacts).set(set).where(eq(stakeholderContacts.id, id));
      }
    },

    async deleteStakeholderContact(id) {
      await db.delete(stakeholderContacts).where(eq(stakeholderContacts.id, id));
    },

    async getContactsByIds(ids) {
      if (!ids.length) return [];
      const rows = await db
        .select({
          id: stakeholderContacts.id,
          name: stakeholderContacts.name,
          email: stakeholderContacts.email,
          title: stakeholderContacts.title,
          orgName: stakeholderOrgs.name,
        })
        .from(stakeholderContacts)
        .innerJoin(stakeholderOrgs, eq(stakeholderContacts.stakeholderOrgId, stakeholderOrgs.id))
        .where(inArray(stakeholderContacts.id, ids));
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        title: r.title ?? undefined,
        orgName: r.orgName,
      }));
    },

    // project roster + distribution defaults

    async listProjectStakeholders(projectId) {
      const links = await db
        .select({ stakeholderOrgId: projectStakeholders.stakeholderOrgId })
        .from(projectStakeholders)
        .where(eq(projectStakeholders.projectId, projectId));
      if (!links.length) return [];
      const ids = links.map((l) => l.stakeholderOrgId);
      const sos = await db
        .select()
        .from(stakeholderOrgs)
        .where(inArray(stakeholderOrgs.id, ids))
        .orderBy(asc(stakeholderOrgs.name));
      const contacts = sos.length
        ? await db
            .select()
            .from(stakeholderContacts)
            .where(inArray(stakeholderContacts.stakeholderOrgId, sos.map((s) => s.id)))
            .orderBy(asc(stakeholderContacts.name))
        : [];
      return mapStakeholderOrgs(sos, contacts);
    },

    async setProjectStakeholders(projectId, stakeholderOrgIds) {
      await db.transaction(async (tx) => {
        await tx.delete(projectStakeholders).where(eq(projectStakeholders.projectId, projectId));
        if (stakeholderOrgIds.length) {
          await tx.insert(projectStakeholders).values(
            stakeholderOrgIds.map((soId) => ({
              id: newId('psk'),
              projectId,
              stakeholderOrgId: soId,
            })),
          );
        }
      });
    },

    async getDistributionDefault(projectId) {
      const r = (
        await db
          .select({ selection: projectDistributionDefaults.selection })
          .from(projectDistributionDefaults)
          .where(eq(projectDistributionDefaults.projectId, projectId))
          .limit(1)
      )[0];
      return r?.selection ?? null;
    },

    async setDistributionDefault(projectId, selection) {
      await db
        .insert(projectDistributionDefaults)
        .values({ projectId, selection, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: projectDistributionDefaults.projectId,
          set: { selection, updatedAt: new Date() },
        });
    },

    // sends + delivery

    async createReportSend(s) {
      await db.insert(reportSends).values({
        id: s.id,
        reportId: s.reportId,
        sentBy: s.sentBy,
        message: s.message ?? null,
      });
    },

    async createRecipients(rs) {
      if (!rs.length) return;
      await db.insert(reportSendRecipients).values(
        rs.map((r) => ({
          id: r.id,
          sendId: r.sendId,
          contactId: r.contactId ?? null,
          email: normEmail(r.email),
          name: r.name,
          token: r.token,
          expiresAt: r.expiresAt,
        })),
      );
    },

    async getRecipientByToken(token) {
      const r = (
        await db
          .select({ rec: reportSendRecipients, reportId: reportSends.reportId })
          .from(reportSendRecipients)
          .innerJoin(reportSends, eq(reportSendRecipients.sendId, reportSends.id))
          .where(eq(reportSendRecipients.token, token))
          .limit(1)
      )[0];
      return r ? { ...r.rec, reportId: r.reportId } : null;
    },

    async recordRecipientOpen(token) {
      await db
        .update(reportSendRecipients)
        .set({
          firstOpenedAt: sql`COALESCE(${reportSendRecipients.firstOpenedAt}, now())`,
          lastOpenedAt: sql`now()`,
          openCount: sql`${reportSendRecipients.openCount} + 1`,
        })
        .where(eq(reportSendRecipients.token, token));
    },

    async revokeRecipient(id) {
      await db
        .update(reportSendRecipients)
        .set({ revokedAt: sql`COALESCE(${reportSendRecipients.revokedAt}, now())` })
        .where(eq(reportSendRecipients.id, id));
    },

    async listSendsForReport(reportId) {
      const sendRows = await db
        .select({
          id: reportSends.id,
          reportId: reportSends.reportId,
          sentAt: reportSends.sentAt,
          uid: users.id,
          uemail: users.email,
          uname: users.name,
        })
        .from(reportSends)
        .leftJoin(users, eq(reportSends.sentBy, users.id))
        .where(eq(reportSends.reportId, reportId))
        .orderBy(desc(reportSends.sentAt));
      if (!sendRows.length) return [];
      const recRows = await db
        .select({ rec: reportSendRecipients, orgName: stakeholderOrgs.name })
        .from(reportSendRecipients)
        .leftJoin(
          stakeholderContacts,
          eq(reportSendRecipients.contactId, stakeholderContacts.id),
        )
        .leftJoin(stakeholderOrgs, eq(stakeholderContacts.stakeholderOrgId, stakeholderOrgs.id))
        .where(inArray(reportSendRecipients.sendId, sendRows.map((s) => s.id)));
      const bySend = new Map<string, typeof recRows>();
      for (const r of recRows) {
        const list = bySend.get(r.rec.sendId) ?? [];
        list.push(r);
        bySend.set(r.rec.sendId, list);
      }
      const out: ReportSend[] = sendRows.map((s) => ({
        id: s.id,
        reportId: s.reportId,
        sentBy: { id: s.uid ?? '', email: s.uemail ?? '', name: s.uname ?? undefined },
        sentAt: iso(s.sentAt),
        recipients: (bySend.get(s.id) ?? [])
          .map(({ rec, orgName }) => ({
            id: rec.id,
            name: rec.name,
            email: rec.email,
            org: orgName ?? undefined,
            sentAt: iso(s.sentAt),
            firstOpenedAt: rec.firstOpenedAt ? iso(rec.firstOpenedAt) : undefined,
            revokedAt: rec.revokedAt ? iso(rec.revokedAt) : undefined,
            openCount: rec.openCount,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
      return out;
    },

    async getReportLatestSendSummary(reportId) {
      const latest = (
        await db
          .select({ id: reportSends.id, sentAt: reportSends.sentAt })
          .from(reportSends)
          .where(eq(reportSends.reportId, reportId))
          .orderBy(desc(reportSends.sentAt))
          .limit(1)
      )[0];
      if (!latest) return null;
      const counts = (
        await db
          .select({
            total: sql<number>`count(*)::int`,
            opened: sql<number>`count(${reportSendRecipients.firstOpenedAt})::int`,
          })
          .from(reportSendRecipients)
          .where(eq(reportSendRecipients.sendId, latest.id))
      )[0];
      return {
        sentAt: iso(latest.sentAt),
        opened: Number(counts?.opened ?? 0),
        total: Number(counts?.total ?? 0),
      };
    },
  };
}

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
} from '@fieldreport/contracts';
import type { SynthesisOutput } from '../synthesis/types.js';
import type { Db } from './client.js';
import type { IngestMediaKeys, ProcessingObservation, Repo } from './types.js';
import { reportIdForWalk } from '../ids.js';
import { projects, reports, observations, photos } from './schema.js';

const iso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

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
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    };
  }

  return {
    async getProject(id) {
      const p = (await db.select().from(projects).where(eq(projects.id, id)).limit(1))[0];
      if (!p) return null;
      return {
        id: p.id,
        name: p.name,
        superName: p.superName,
        glossary: p.glossary ?? [],
        baseLexiconRef: p.baseLexiconRef,
      };
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
  };
}

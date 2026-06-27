/**
 * Processing pipeline (wiring): uploaded -> transcribing -> synthesizing -> rendering
 * -> ready. Runs async after upload responds; the client polls /status. Any failure is
 * recorded as processing='failed' with the error so the admin/review UIs can surface it.
 */
import type { ServerDeps } from './deps.js';
import type { SynthesisInput } from './synthesis/types.js';
import { assembleKeyterms } from './stt/index.js';
import { renderReportHtml, renderReportPdf } from './render/index.js';
import { buildRenderModel } from './render-model.js';
import { storageKeys } from './storage/types.js';

/** Run async tasks with bounded concurrency, preserving input order of side effects. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items.entries()];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      await fn(next[1]);
    }
  });
  await Promise.all(workers);
}

/** Render the current report state (data-URL photos) to HTML+PDF and store both. */
export async function renderAndStore(
  deps: ServerDeps,
  reportId: string,
  reviewed: boolean,
): Promise<{ htmlKey: string; pdfKey: string }> {
  const { repo, storage } = deps;
  const report = await repo.getReport(reportId);
  if (!report) throw new Error(`report ${reportId} not found`);
  const projectId = await repo.getReportProjectId(reportId);
  const project = projectId ? await repo.getProject(projectId) : null;

  const model = await buildRenderModel(report, storage, project?.name ?? 'Project', reviewed);
  const html = renderReportHtml(model);
  const pdf = await renderReportPdf(html);

  const htmlKey = storageKeys.html(reportId);
  const pdfKey = storageKeys.pdf(reportId);
  await storage.put(htmlKey, new TextEncoder().encode(html), {
    contentType: 'text/html; charset=utf-8',
    cacheControl: 'no-cache',
  });
  await storage.put(pdfKey, pdf, { contentType: 'application/pdf' });
  await repo.setRenderArtifacts(reportId, { htmlKey, pdfKey });
  return { htmlKey, pdfKey };
}

export async function runPipeline(deps: ServerDeps, reportId: string): Promise<void> {
  const { repo, storage, transcriber, synthesizer, config } = deps;
  try {
    const projectId = await repo.getReportProjectId(reportId);
    const project = projectId ? await repo.getProject(projectId) : null;

    // 1. Transcribe (vocabulary-biased; bounded concurrency over short clips).
    await repo.setProcessing(reportId, 'transcribing');
    const keyterms = assembleKeyterms(project?.glossary ?? []);
    const procObs = await repo.getProcessingObservations(reportId);
    await mapLimit(procObs, 4, async (o) => {
      if (!o.audioKey) return;
      try {
        const audio = await storage.get(o.audioKey);
        const res = await transcriber.transcribe(
          { bytes: audio.bytes, mime: o.audioMime ?? 'audio/webm', observationId: o.id },
          { keyterms, language: config.stt.language },
        );
        await repo.setTranscript(o.id, res.text, res.confidence);
      } catch {
        // A single bad clip must not sink the whole report; leave its transcript empty
        // and let synthesis write a neutral "unclear" placeholder for it.
        await repo.setTranscript(o.id, '');
      }
    });

    // 2. Synthesize (the IP) — one call over the ordered, transcribed walk.
    await repo.setProcessing(reportId, 'synthesizing');
    const transcribed = await repo.getReport(reportId);
    if (!transcribed) throw new Error('report not found mid-pipeline');
    const input: SynthesisInput = {
      project: {
        name: project?.name ?? 'Project',
        superName: transcribed.superName,
        date: transcribed.date,
        glossary: project?.glossary ?? [],
      },
      observations: transcribed.observations.map((o) => ({
        id: o.id,
        order: o.order,
        transcript: o.transcript ?? '',
        photoCount: o.photos.length,
      })),
    };
    const out = await synthesizer.synthesize(input);
    await repo.applySynthesis(reportId, out);

    // 3. Render draft HTML + PDF.
    await repo.setProcessing(reportId, 'rendering');
    await renderAndStore(deps, reportId, false);

    // 4. Ready for review.
    await repo.setProcessing(reportId, 'ready');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await repo.setProcessing(reportId, 'failed', msg).catch(() => {});
    throw err;
  }
}

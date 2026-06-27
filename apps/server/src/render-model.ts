/**
 * Build a ReportRenderModel from a Report contract + storage. Photos are inlined as
 * data: URLs so the hosted HTML and the PDF are fully self-contained (render needs no
 * network — works in dry-run and survives storage-URL expiry). Shared by the pipeline
 * (draft render) and finalize (reviewed render).
 */
import type { Report } from '@fieldreport/contracts';
import type { StorageDriver } from './storage/types.js';
import type { ReportRenderModel, RenderObservation } from './render/types.js';

async function toDataUrl(storage: StorageDriver, key: string): Promise<string> {
  const obj = await storage.get(key);
  const b64 = Buffer.from(obj.bytes).toString('base64');
  return `data:${obj.contentType};base64,${b64}`;
}

export async function buildRenderModel(
  report: Report,
  storage: StorageDriver,
  projectName: string,
  reviewed: boolean,
): Promise<ReportRenderModel> {
  const observations: RenderObservation[] = [];
  for (const o of [...report.observations].sort((a, b) => a.order - b.order)) {
    const photos = [];
    for (const p of o.photos) {
      photos.push({
        id: p.id,
        url: p.blobRef ? await toDataUrl(storage, p.blobRef) : '',
        width: p.width,
        height: p.height,
      });
    }
    observations.push({
      id: o.id,
      order: o.order,
      cleanedDescription:
        o.cleanedDescription?.trim() ||
        'Observation recorded; description pending synthesis.',
      transcript: o.transcript,
      trade: o.trade,
      area: o.area,
      photos,
    });
  }
  return {
    id: report.id,
    projectName,
    date: report.date,
    superName: report.superName,
    summary: report.summary,
    observations,
    reviewed,
  };
}

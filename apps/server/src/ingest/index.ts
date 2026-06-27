/**
 * Ingest (spec §3 backend, §9 EXIF). Pure-ish: the route collects multipart parts into
 * a manifest + a fieldname->bytes map, then hands them here. We EXIF-correct + resize
 * each photo (so it never renders sideways), store all media, and persist rows
 * idempotently. Decoupled from Fastify so it is unit-testable.
 */
import sharp from 'sharp';
import { audioFieldFor, type UploadManifest, type UploadResult } from '@fieldreport/contracts';
import { storageKeys, type StorageDriver } from '../storage/types.js';
import type { IngestMediaKeys, Repo } from '../db/types.js';
import { reportIdForWalk, audioExtForMime } from '../ids.js';

const MAX_DIM = 2000; // px; server cap independent of client compression
const JPEG_QUALITY = 80;

export interface ProcessUploadArgs {
  manifest: UploadManifest;
  files: Map<string, Uint8Array>;
  storage: StorageDriver;
  repo: Repo;
}

/** EXIF-correct (auto-rotate), bound dimensions, re-encode JPEG. Returns bytes + dims. */
export async function normalizePhoto(
  input: Uint8Array,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const pipeline = sharp(Buffer.from(input))
    .rotate() // applies EXIF orientation, then strips it — the §9 fix
    .resize({ width: MAX_DIM, height: MAX_DIM, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true });
  const out = await pipeline.toBuffer({ resolveWithObject: true });
  return {
    bytes: new Uint8Array(out.data),
    width: out.info.width,
    height: out.info.height,
  };
}

export async function processUpload(args: ProcessUploadArgs): Promise<UploadResult> {
  const { manifest, files, storage, repo } = args;
  const reportId = reportIdForWalk(manifest.walkId);
  const media: IngestMediaKeys = { photos: {}, audio: {} };

  for (const obs of manifest.observations) {
    for (const photo of obs.photos) {
      const raw = files.get(photo.id);
      if (!raw) throw new Error(`missing photo bytes for ${photo.id}`);
      const norm = await normalizePhoto(raw);
      const key = storageKeys.photo(reportId, photo.id);
      await storage.put(key, norm.bytes, { contentType: 'image/jpeg' });
      media.photos[photo.id] = {
        key,
        width: norm.width,
        height: norm.height,
        byteSize: norm.bytes.byteLength,
      };
    }

    const audioField = obs.audioField || audioFieldFor(obs.id);
    const audioBytes = files.get(audioField);
    if (audioBytes) {
      const ext = audioExtForMime(obs.audioMime);
      const key = storageKeys.audio(reportId, obs.id, ext);
      await storage.put(key, audioBytes, { contentType: obs.audioMime || 'audio/webm' });
      media.audio[obs.id] = { key, mime: obs.audioMime || 'audio/webm', ext };
    }
  }

  const result = await repo.createReportFromUpload(manifest, media);
  return {
    reportId: result.reportId,
    walkId: manifest.walkId,
    processing: 'uploaded',
    acceptedObservationIds: result.acceptedObservationIds,
  };
}

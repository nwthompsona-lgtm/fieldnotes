// SYNC (spec §7) — foreground-only upload. iOS has NO Background Sync, so this
// ONLY ever runs while the app is open and the user is looking at progress.
//
// Builds the exact multipart body the frozen UPLOAD CONTRACT specifies:
//   POST {API_BASE}/api/upload   multipart/form-data
//     - "manifest" = JSON.stringify(UploadManifest)
//     - each photo's bytes under a field NAMED photo.id, filename `${photo.id}.jpg`
//     - each obs's audio bytes under field audioFieldFor(obs.id) === `audio:${obs.id}`
//   Response = UploadResult JSON.
//
// Idempotent: the same walkId is reused on every retry so the server never
// double-creates. Retries use exponential backoff for a few attempts.

import {
  CONTRACTS_VERSION,
  audioFieldFor,
  UploadManifest,
  UploadResult,
  type UploadObservation,
} from '@fieldreport/contracts';
import { db } from './db';
import { UPLOAD_URL } from './config';
import { getObservationsForWalk, getPhotosForObs, getAudioForObs, clearAckedObservations } from './repo';
import { isStandalone } from './lib/install';

export interface SyncProgress {
  /** Per-observation upload state (built before the request fires). */
  totalObservations: number;
  /** 0..1 overall — based on bytes flushed to the network. */
  fraction: number;
  /** Human status line. */
  phase: 'building' | 'uploading' | 'success' | 'error';
  message?: string;
}

export type ProgressCb = (p: SyncProgress) => void;

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Assemble the FormData body for a walk straight from the durable store. */
async function buildUploadBody(walkId: string): Promise<{ form: FormData; obsCount: number }> {
  const walk = await db.walks.get(walkId);
  if (!walk) throw new Error('Walk no longer exists locally.');

  const observations = await getObservationsForWalk(walkId);
  const manifestObservations: UploadObservation[] = [];
  const form = new FormData();

  for (const obs of observations) {
    const photos = await getPhotosForObs(obs.id);
    const audio = await getAudioForObs(obs.id);

    // Attach each photo's bytes under a field NAMED exactly photo.id.
    const photoMeta = photos.map((p) => {
      form.append(p.id, new File([p.blob], `${p.id}.jpg`, { type: 'image/jpeg' }), `${p.id}.jpg`);
      return { id: p.id, width: p.width, height: p.height, byteSize: p.byteSize };
    });

    // Attach the voice note under `audio:${obs.id}`.
    const audioField = audioFieldFor(obs.id);
    const audioMime = audio?.mime ?? 'audio/webm';
    if (audio) {
      const ext = audioMime.includes('mp4') || audioMime.includes('aac') ? 'm4a' : 'webm';
      form.append(audioField, new File([audio.blob], `${obs.id}.${ext}`, { type: audioMime }), `${obs.id}.${ext}`);
    }

    manifestObservations.push({
      id: obs.id,
      order: obs.order,
      createdAt: obs.createdAt,
      photos: photoMeta,
      audioField,
      audioMime,
    });
  }

  const manifest = UploadManifest.parse({
    contractsVersion: CONTRACTS_VERSION,
    projectId: walk.projectId,
    projectName: walk.projectName || undefined,
    superName: walk.superName,
    date: walk.date,
    walkId: walk.id,
    observations: manifestObservations,
    client: {
      ua: navigator.userAgent,
      installed: isStandalone(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  });

  form.append('manifest', JSON.stringify(manifest));
  return { form, obsCount: manifestObservations.length };
}

/**
 * POST the multipart body with XHR so we get real upload-progress events
 * (fetch has no upload progress). Resolves with the parsed UploadResult.
 */
function postWithProgress(
  url: string,
  form: FormData,
  onFraction: (f: number) => void,
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onFraction(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = UploadResult.parse(JSON.parse(xhr.responseText));
          resolve(parsed);
        } catch (err) {
          reject(new Error(`Server response was not a valid UploadResult: ${(err as Error).message}`));
        }
      } else {
        reject(new Error(`Upload failed (HTTP ${xhr.status}). ${xhr.responseText?.slice(0, 200) ?? ''}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error during upload.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out.'));
    xhr.timeout = 120_000;
    xhr.send(form);
  });
}

/**
 * Upload one walk with retry/backoff. Calls onProgress throughout. On success,
 * clears only the acked observations from the durable store.
 */
export async function syncWalk(walkId: string, onProgress: ProgressCb): Promise<UploadResult> {
  onProgress({ totalObservations: 0, fraction: 0, phase: 'building' });

  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Rebuild the body each attempt — the store is the source of truth and
      // the same walkId guarantees idempotency on the server.
      const { form, obsCount } = await buildUploadBody(walkId);
      onProgress({ totalObservations: obsCount, fraction: 0, phase: 'uploading' });

      const result = await postWithProgress(UPLOAD_URL, form, (f) =>
        onProgress({ totalObservations: obsCount, fraction: f, phase: 'uploading' }),
      );

      await clearAckedObservations(walkId, result.acceptedObservationIds);
      onProgress({ totalObservations: obsCount, fraction: 1, phase: 'success' });
      return result;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) {
        const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
        onProgress({
          totalObservations: 0,
          fraction: 0,
          phase: 'uploading',
          message: `Attempt ${attempt} failed — retrying in ${Math.round(delay / 1000)}s…`,
        });
        await sleep(delay);
      }
    }
  }

  onProgress({
    totalObservations: 0,
    fraction: 0,
    phase: 'error',
    message: lastErr?.message ?? 'Upload failed.',
  });
  throw lastErr ?? new Error('Upload failed.');
}

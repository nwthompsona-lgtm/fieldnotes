// Repository — the ONLY module that mutates the durable store. Every capture
// action funnels through here so the "write the blob before anything else"
// guarantee (spec §4) lives in one place and the UI can stay dumb.

import { db, type WalkRow, type ObservationRow, type PhotoRow, type AudioRow } from './db';
import { uuid } from './lib/ids';
import { localDateYmd } from './lib/format';
import { PROJECT_ID, SUPER_NAME } from './config';
import type { CompressedImage } from './lib/image';

/** Get the active capturing walk, creating one if none exists. */
export async function getOrCreateActiveWalk(): Promise<WalkRow> {
  const existing = await db.walks.where('status').equals('capturing').first();
  if (existing) return existing;
  const walk: WalkRow = {
    id: uuid(),
    projectId: PROJECT_ID,
    superName: SUPER_NAME,
    date: localDateYmd(),
    createdAt: new Date().toISOString(),
    status: 'capturing',
  };
  await db.walks.add(walk);
  return walk;
}

/** Walks that are finished capturing and awaiting/needing upload. */
export async function getPendingWalks(): Promise<WalkRow[]> {
  return db.walks.where('status').equals('pending').sortBy('createdAt');
}

/** Next order index for a new observation within a walk. */
async function nextObservationOrder(walkId: string): Promise<number> {
  return db.observations.where('walkId').equals(walkId).count();
}

/** Create a new empty observation shell (no media yet). */
export async function createObservation(walkId: string): Promise<ObservationRow> {
  const obs: ObservationRow = {
    id: uuid(),
    walkId,
    order: await nextObservationOrder(walkId),
    createdAt: new Date().toISOString(),
  };
  await db.observations.add(obs);
  return obs;
}

/**
 * Persist a compressed photo IMMEDIATELY. Returns the photo id. This is called
 * the instant compression finishes, before any UI transition.
 */
export async function addPhoto(
  walkId: string,
  obsId: string,
  img: CompressedImage,
): Promise<string> {
  const order = await db.photos.where('obsId').equals(obsId).count();
  const row: PhotoRow = {
    id: uuid(),
    obsId,
    walkId,
    blob: img.blob,
    width: img.width,
    height: img.height,
    byteSize: img.byteSize,
    order,
  };
  await db.photos.add(row);
  return row.id;
}

/** Persist the voice note blob IMMEDIATELY when recording stops. */
export async function setAudio(
  walkId: string,
  obsId: string,
  blob: Blob,
  mime: string,
): Promise<void> {
  const row: AudioRow = { obsId, walkId, blob, mime };
  await db.audio.put(row); // put = one voice note per observation
}

/** Delete the voice note for an observation (e.g. before a re-record). */
export async function deleteAudio(obsId: string): Promise<void> {
  await db.audio.delete(obsId);
}

export async function getPhotosForObs(obsId: string): Promise<PhotoRow[]> {
  const rows = await db.photos.where('obsId').equals(obsId).toArray();
  return rows.sort((a, b) => a.order - b.order);
}

export async function getAudioForObs(obsId: string): Promise<AudioRow | undefined> {
  return db.audio.get(obsId);
}

export async function getObservationsForWalk(walkId: string): Promise<ObservationRow[]> {
  const rows = await db.observations.where('walkId').equals(walkId).toArray();
  return rows.sort((a, b) => a.order - b.order);
}

/** Delete a single photo. */
export async function deletePhoto(photoId: string): Promise<void> {
  await db.photos.delete(photoId);
}

/**
 * Delete an entire observation (its photos + audio + row). Used by the running
 * list DELETE action and also to clean up an empty/abandoned observation shell.
 */
export async function deleteObservation(obsId: string): Promise<void> {
  await db.transaction('rw', db.photos, db.audio, db.observations, async () => {
    await db.photos.where('obsId').equals(obsId).delete();
    await db.audio.delete(obsId);
    await db.observations.delete(obsId);
  });
}

/** Discard observation shells that ended up with no photos (canceled capture). */
export async function pruneEmptyObservations(walkId: string): Promise<void> {
  // Wrap the read + prune in ONE rw transaction so a concurrent capture can't
  // add a photo to an observation between the empty-check and the delete (which
  // would either drop a real photo or act on a stale count). Atomic & correct.
  await db.transaction('rw', db.observations, db.photos, db.audio, async () => {
    const obs = await db.observations.where('walkId').equals(walkId).toArray();
    for (const o of obs) {
      const count = await db.photos.where('obsId').equals(o.id).count();
      if (count === 0) {
        await db.photos.where('obsId').equals(o.id).delete();
        await db.audio.delete(o.id);
        await db.observations.delete(o.id);
      }
    }
  });
}

/** Total bytes stored for a walk (photos + audio) — for the "~MB" readout. */
export async function walkByteSize(walkId: string): Promise<number> {
  let total = 0;
  await db.photos
    .where('walkId')
    .equals(walkId)
    .each((p) => {
      total += p.byteSize || p.blob.size;
    });
  await db.audio
    .where('walkId')
    .equals(walkId)
    .each((a) => {
      total += a.blob.size;
    });
  return total;
}

/** Mark the active walk finished-capturing -> pending upload. */
export async function finishWalk(walkId: string): Promise<void> {
  await pruneEmptyObservations(walkId);
  await db.walks.update(walkId, { status: 'pending' });
}

/**
 * After a successful upload, delete ONLY the acked observations and, if the
 * walk is fully drained, the walk row itself. Idempotent and safe to re-run.
 */
export async function clearAckedObservations(
  walkId: string,
  acceptedObservationIds: string[],
): Promise<void> {
  for (const obsId of acceptedObservationIds) {
    await deleteObservation(obsId);
  }
  const remaining = await db.observations.where('walkId').equals(walkId).count();
  if (remaining === 0) {
    await db.walks.delete(walkId);
  }
}

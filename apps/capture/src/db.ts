// Durable local store (spec §4) — IndexedDB via Dexie.
//
// DURABILITY IS SACRED. The instant a photo is compressed or audio recording
// stops, its Blob is written here BEFORE anything else touches the UI. A
// backgrounded app, an incoming phone call, or a crash mid-walk must lose
// nothing. Nothing about a capture session lives only in React state.
//
// One IndexedDB row per piece of media keeps writes small and atomic; we never
// rewrite a giant document blob, so a partial write can't corrupt prior captures.

import Dexie, { type Table } from 'dexie';

/** A walk = one site visit = one upload bundle (idempotency key = id). */
export interface WalkRow {
  /** uuid — also the upload idempotency key (walkId). */
  id: string;
  /** Stable id derived from projectName; empty until the user names the project. */
  projectId: string;
  /** Human-readable project label the user typed. Empty until set on the Review screen. */
  projectName: string;
  /** Name of whoever prepared the report. Empty until set on the Review screen. */
  superName: string;
  /** YYYY-MM-DD, device-local at walk start. */
  date: string;
  createdAt: string; // ISO8601
  /** 'capturing' while in progress, 'pending' once the super taps "Done". */
  status: 'capturing' | 'pending';
}

/** Observation metadata. Media lives in the photos/audio tables, keyed by id. */
export interface ObservationRow {
  id: string;
  walkId: string;
  order: number;
  createdAt: string; // ISO8601
}

export interface PhotoRow {
  id: string;
  obsId: string;
  walkId: string;
  blob: Blob; // compressed jpeg bytes
  width: number; // natural width of captured image
  height: number; // natural height
  byteSize: number;
  order: number; // order within the observation
}

export interface AudioRow {
  /** One voice note per observation, so obsId is the primary key. */
  obsId: string;
  walkId: string;
  blob: Blob;
  mime: string; // actual recorded mime (varies iOS vs others)
}

export class CaptureDB extends Dexie {
  walks!: Table<WalkRow, string>;
  observations!: Table<ObservationRow, string>;
  photos!: Table<PhotoRow, string>;
  audio!: Table<AudioRow, string>;

  constructor() {
    super('fieldreport-capture');
    this.version(1).stores({
      // Only indexed fields are listed; blobs ride along on the row.
      walks: 'id, status, createdAt',
      observations: 'id, walkId, order',
      photos: 'id, obsId, walkId',
      audio: 'obsId, walkId',
    });
  }
}

export const db = new CaptureDB();

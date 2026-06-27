import { describe, it, expect } from 'vitest';
import {
  UploadManifest,
  Observation,
  audioFieldFor,
  CONTRACTS_VERSION,
  BASE_CONSTRUCTION_LEXICON,
} from '../src/index.js';

describe('contracts', () => {
  it('exposes a version and a non-trivial base lexicon', () => {
    expect(CONTRACTS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BASE_CONSTRUCTION_LEXICON.length).toBeGreaterThan(40);
    expect(BASE_CONSTRUCTION_LEXICON).toContain('EIFS');
  });

  it('validates a well-formed observation', () => {
    const ok = Observation.safeParse({
      id: 'obs-00000001',
      order: 0,
      createdAt: '2026-06-27T14:00:00.000Z',
      photos: [{ id: 'pho-00000001', width: 1600, height: 1200 }],
      audioRef: '',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects an observation with no photos', () => {
    const bad = Observation.safeParse({
      id: 'obs-00000001',
      order: 0,
      createdAt: '2026-06-27T14:00:00.000Z',
      photos: [],
      audioRef: '',
    });
    expect(bad.success).toBe(false);
  });

  it('round-trips a minimal upload manifest', () => {
    const manifest = {
      contractsVersion: CONTRACTS_VERSION,
      projectId: 'proj-1',
      superName: 'Test Super',
      date: '2026-06-27',
      walkId: 'walk-0001-abcd',
      observations: [
        {
          id: 'obs-00000001',
          order: 0,
          createdAt: '2026-06-27T14:00:00.000Z',
          photos: [{ id: 'pho-00000001', width: 1600, height: 1200 }],
          audioField: audioFieldFor('obs-00000001'),
          audioMime: 'audio/webm',
        },
      ],
    };
    const parsed = UploadManifest.parse(manifest);
    expect(parsed.observations[0]!.audioField).toBe('audio:obs-00000001');
  });
});

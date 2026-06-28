import { describe, it, expect } from 'vitest';
import { reportIdForWalk, audioExtForMime } from '../src/ids.js';
import { assembleKeyterms } from '../src/stt/index.js';
import { BASE_CONSTRUCTION_LEXICON } from '@fieldreport/contracts';

describe('ids', () => {
  it('reportIdForWalk is deterministic and stable per walk', () => {
    expect(reportIdForWalk('walk-abc')).toBe(reportIdForWalk('walk-abc'));
    expect(reportIdForWalk('walk-abc')).not.toBe(reportIdForWalk('walk-xyz'));
    expect(reportIdForWalk('walk-abc')).toMatch(/^r-[0-9a-f]{20}$/);
  });

  it('audioExtForMime maps device mimes to extensions', () => {
    expect(audioExtForMime('audio/mp4')).toBe('m4a');
    expect(audioExtForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(audioExtForMime('audio/ogg')).toBe('ogg');
  });
});

describe('assembleKeyterms (spec §8a)', () => {
  it('puts the project glossary first and includes the base lexicon, deduped', () => {
    const terms = assembleKeyterms(['Watson Island', 'JMA', 'Metal Stud']);
    expect(terms[0]).toBe('Watson Island');
    expect(terms).toContain('JMA');
    // 'Metal Stud' duplicates base lexicon 'metal stud' (case-insensitive) — only one survives.
    expect(terms.filter((t) => t.toLowerCase() === 'metal stud')).toHaveLength(1);
    expect(terms.length).toBeGreaterThan(BASE_CONSTRUCTION_LEXICON.length);
  });
});

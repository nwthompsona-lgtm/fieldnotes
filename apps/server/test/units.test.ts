import { describe, it, expect } from 'vitest';
import { reportIdForWalk, audioExtForMime } from '../src/ids.js';
import { assembleKeyterms } from '../src/stt/index.js';
import { reportPdfFilename, inlinePdfDisposition } from '../src/filenames.js';
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

describe('PDF filenames (14d)', () => {
  it('reportPdfFilename: "<Project> – <date>.pdf", sanitized, with fallbacks', () => {
    expect(reportPdfFilename('Watson Island', '2026-07-07')).toBe('Watson Island – 2026-07-07.pdf');
    // Filesystem-hostile characters collapse to spaces.
    expect(reportPdfFilename('A/B: C*D?"E"<F>|G\\H', '2026-01-02')).toBe('A B C D E F G H – 2026-01-02.pdf');
    expect(reportPdfFilename(undefined, '2026-01-02')).toBe('Field report – 2026-01-02.pdf');
    expect(reportPdfFilename('   ', '2026-01-02')).toBe('Field report – 2026-01-02.pdf');
    // Very long names are capped, the suffix survives.
    expect(reportPdfFilename('x'.repeat(300), '2026-01-02')).toBe(`${'x'.repeat(120)} – 2026-01-02.pdf`);
  });

  it('inlinePdfDisposition: ASCII fallback + RFC 5987 filename*', () => {
    expect(inlinePdfDisposition('Watson Island – 2026-07-07.pdf')).toBe(
      `inline; filename="Watson Island - 2026-07-07.pdf"; filename*=UTF-8''Watson%20Island%20%E2%80%93%202026-07-07.pdf`,
    );
    // Quotes/backslashes can't break out of the quoted fallback.
    expect(inlinePdfDisposition('a"b\\c – 1.pdf')).toContain('filename="ab');
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

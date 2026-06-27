import { describe, it, expect } from 'vitest';
import { MockSynthesizer } from '../src/synthesis/mock.js';
import type { SynthesisInput } from '../src/synthesis/types.js';

const synth = new MockSynthesizer();

function input(transcripts: string[]): SynthesisInput {
  return {
    project: { name: 'Watson Island', superName: 'Test', date: '2026-06-27', glossary: [] },
    observations: transcripts.map((t, i) => ({ id: `obs-${i}`, order: i, transcript: t, photoCount: 1 })),
  };
}

describe('synthesis fidelity (mock) — the liability gate (spec §3)', () => {
  it('does NOT upgrade tentative work to complete (prepped stays prepped)', async () => {
    const out = await synth.synthesize(
      input(["this is the slab on P2, it's formed up and we're prepped for the pour tomorrow"]),
    );
    const desc = out.observations[0]!.cleanedDescription.toLowerCase();
    expect(desc).toContain('prepped');
    expect(desc).not.toMatch(/\bpoured\b/);
  });

  it('turns a garbled clip into a neutral placeholder, not a fabrication', async () => {
    const out = await synth.synthesize(input(['uh yeah this is the, hang on [inaudible] sorry']));
    expect(out.observations[0]!.cleanedDescription.toLowerCase()).toContain('unclear');
  });

  it('infers trade and area when clearly indicated', async () => {
    const out = await synth.synthesize(
      input(["we're on level three of the north tower, drywall's hung and they're taping"]),
    );
    expect(out.observations[0]!.trade).toBe('Drywall');
    expect(out.observations[0]!.area).toBe('Level Three');
  });

  it('surfaces a safety deficiency into the summary', async () => {
    const out = await synth.synthesize(
      input(['no guardrail on the west leading edge, that is a real fall hazard']),
    );
    expect(out.summary.toLowerCase()).toContain('fall-protection');
  });

  it('returns exactly one output per input id, in order', async () => {
    const out = await synth.synthesize(input(['a b c d', 'e f g h', 'i j k l']));
    expect(out.observations.map((o) => o.id)).toEqual(['obs-0', 'obs-1', 'obs-2']);
  });
});

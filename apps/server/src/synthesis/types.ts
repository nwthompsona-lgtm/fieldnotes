/**
 * Synthesis seam (spec §8b — the IP). Input is the ordered, transcribed walk plus
 * light project context; output is per-observation polished prose + inferred
 * trade/area + a daily summary. The `Synthesizer` interface is the swap point:
 * the real Claude provider and the deterministic mock both implement it.
 */
import { z } from 'zod';

export interface SynthesisProjectContext {
  name: string;
  superName: string;
  date: string; // YYYY-MM-DD
  /** Per-project proper nouns so spelling is correct in the prose (§8). */
  glossary: string[];
}

export interface SynthesisObservationInput {
  id: string;
  order: number;
  /** Verbatim STT output (may be empty/garbled — the prompt must handle that). */
  transcript: string;
  photoCount: number;
}

export interface SynthesisInput {
  project: SynthesisProjectContext;
  observations: SynthesisObservationInput[];
}

/** Input for regenerating ONLY the daily summary from the (possibly edited) polished
 *  observation descriptions — used when a super corrects a narration during review. */
export interface SummaryObservationInput {
  id: string;
  order: number;
  cleanedDescription: string;
  trade?: string;
  area?: string;
}
export interface SummaryInput {
  project: SynthesisProjectContext;
  observations: SummaryObservationInput[];
}

/** Strict output shape the model must return (also used to validate its JSON). */
export const SynthesisObservationOutput = z.object({
  id: z.string(),
  cleanedDescription: z.string(),
  trade: z.string().optional(),
  area: z.string().optional(),
});
export type SynthesisObservationOutput = z.infer<typeof SynthesisObservationOutput>;

export const SynthesisOutput = z.object({
  summary: z.string(),
  observations: z.array(SynthesisObservationOutput),
});
export type SynthesisOutput = z.infer<typeof SynthesisOutput>;

export interface Synthesizer {
  readonly name: string;
  synthesize(input: SynthesisInput): Promise<SynthesisOutput>;
  /** Regenerate just the daily summary from current observation descriptions. */
  resummarize(input: SummaryInput): Promise<string>;
}

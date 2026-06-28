/**
 * Deterministic mock synthesizer — runs the full pipeline offline with no Anthropic key
 * and is a sane no-key prod fallback. It cleans filler, infers trade/area by keyword,
 * and writes a factual summary. It deliberately does NOT upgrade tentative work to
 * complete (the prepped-vs-poured fidelity rule) — it only tidies, never re-asserts.
 */
import type { SynthesisInput, SummaryInput, SynthesisOutput, Synthesizer } from './types.js';

const TRADE_RULES: Array<[RegExp, string]> = [
  [/\b(drywall|gypsum|taping|mudding|skim)\b/i, 'Drywall'],
  [/\b(slab|rebar|formwork|pour|poured|concrete|topping|honeycomb)\b/i, 'Concrete'],
  [/\b(curtain wall|mullion|storefront|glazing|glass|spandrel)\b/i, 'Glazing'],
  [/\b(ductwork|condensate|mechanical|vav|fan coil|hvac)\b/i, 'HVAC/Mechanical'],
  [/\b(riser|plumbing|top-?out|stub|sanitary)\b/i, 'Plumbing'],
  [/\b(eifs|waterproofing|membrane|flashing|sealant)\b/i, 'Waterproofing'],
  [/\b(elevator|hoistway|shaft|car)\b/i, 'Elevators'],
  [/\b(framing|stud|leading edge)\b/i, 'Framing'],
  [/\b(roof|bulkhead|parapet|coping)\b/i, 'Roofing'],
  [/\b(stone|millwork|casework|tile|flooring)\b/i, 'Finishes'],
];

const AREA_RULES: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/\blevel\s+(\w+)\b/i, (m) => `Level ${cap(m[1]!)}`],
  [/\b(north|south|east|west)\s+tower\b/i, (m) => `${cap(m[1]!)} Tower`],
  [/\bp(\d)\b/i, (m) => `Parking — P${m[1]}`],
  [/\bpodium\b/i, () => 'Podium'],
  [/\bmarina level\b/i, () => 'Marina Level'],
  [/\bamenity deck\b/i, () => 'Amenity Deck'],
  [/\blobby\b/i, () => 'Lobby'],
  [/\broof\b/i, () => 'Roof'],
];

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isUnclear(t: string): boolean {
  const s = t.trim();
  return !s || /\[(inaudible|unintelligible|noise)\]/i.test(s) || s.length < 8;
}

function clean(transcript: string): string {
  let t = transcript.trim();
  // strip leading filler and discourse markers
  t = t.replace(/^(okay|ok|so|um+|uh+|yeah|alright|right)[,\s]+/gi, '');
  t = t.replace(/\b(uh+|um+|you know|like,|sort of|kind of)\b/gi, '');
  t = t.replace(/\bi'?m (grabbing|getting|taking) a (shot|picture|photo) of\b/gi, 'Pictured here is');
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([.,])/g, '$1').trim();
  if (t) t = cap(t);
  if (t && !/[.!?]$/.test(t)) t += '.';
  return t;
}

export class MockSynthesizer implements Synthesizer {
  readonly name = 'mock';

  async synthesize(input: SynthesisInput): Promise<SynthesisOutput> {
    let safety = false;
    const observations = [...input.observations]
      .sort((a, b) => a.order - b.order)
      .map((o) => {
        const raw = o.transcript ?? '';
        if (/\b(guardrail|fall hazard|hazard|no rail|unprotected)\b/i.test(raw)) safety = true;
        if (isUnclear(raw)) {
          return {
            id: o.id,
            cleanedDescription:
              'Observation recorded; narration was unclear and should be confirmed by the superintendent.',
          };
        }
        const trade = TRADE_RULES.find(([re]) => re.test(raw))?.[1];
        let area: string | undefined;
        for (const [re, fmt] of AREA_RULES) {
          const m = re.exec(raw);
          if (m) {
            area = fmt(m);
            break;
          }
        }
        return { id: o.id, cleanedDescription: clean(raw), trade, area };
      });

    const n = observations.length;
    const summaryParts = [
      `Site walk of ${input.project.name} on ${input.project.date}, covering ${n} observation${n === 1 ? '' : 's'} across active areas.`,
      'Work is progressing across multiple trades; details for each observation follow below.',
    ];
    if (safety) {
      summaryParts.push(
        'A fall-protection deficiency was identified during the walk and flagged to the responsible foreman for immediate correction.',
      );
    }
    return { summary: summaryParts.join(' '), observations };
  }

  /** Regenerate the summary from the (edited) polished descriptions — deterministic. */
  async resummarize(input: SummaryInput): Promise<string> {
    const obs = [...input.observations].sort((a, b) => a.order - b.order);
    const n = obs.length;
    const text = obs.map((o) => o.cleanedDescription ?? '').join(' ');
    const safety = /\b(guardrail|fall hazard|hazard|no rail|unprotected|deficien)\b/i.test(text);
    const areas = [...new Set(obs.map((o) => o.area).filter(Boolean))] as string[];
    const where = areas.length
      ? ` across ${areas.slice(0, 3).join(', ')}${areas.length > 3 ? ', and other areas' : ''}`
      : ' across active areas';
    const parts = [
      `Site walk of ${input.project.name} on ${input.project.date}, covering ${n} observation${n === 1 ? '' : 's'}${where}.`,
      'Work is progressing across multiple trades; details for each observation follow below.',
    ];
    if (safety) {
      parts.push(
        'A deficiency requiring attention was noted during the walk and flagged to the responsible foreman.',
      );
    }
    return parts.join(' ');
  }
}

/**
 * Claude synthesizer (the IP in production). Sends the frozen system prompt + the
 * ordered transcripts, parses the model's JSON (tolerant extraction + zod validation),
 * with one repair retry. Wrapped in a LangSmith trace when tracing is enabled so the
 * prompt/output can be inspected and iterated (spec §3, §8b).
 *
 * Uses messages.create (stable across SDK versions) + prompt-enforced JSON rather than
 * the structured-outputs helper, so it works on the installed SDK and is model-agnostic.
 */
import Anthropic from '@anthropic-ai/sdk';
import { traceable } from 'langsmith/traceable';
import type { AppConfig } from '../config.js';
import { SYSTEM_PROMPT, SYNTHESIS_PROMPT_VERSION, buildUserMessage } from './prompt.js';
import { SynthesisOutput, type SynthesisInput, type Synthesizer } from './types.js';

function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence?.[1]) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

export class ClaudeSynthesizer implements Synthesizer {
  readonly name = 'claude';
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private run: (input: SynthesisInput) => Promise<SynthesisOutput>;

  constructor(cfg: AppConfig) {
    if (!cfg.synthesis.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY required for claude');
    this.client = new Anthropic({ apiKey: cfg.synthesis.anthropicApiKey });
    this.model = cfg.synthesis.model;
    this.maxTokens = cfg.synthesis.maxTokens;
    const core = (input: SynthesisInput) => this.execute(input);
    this.run = cfg.langsmith.enabled
      ? (traceable(core, {
          name: 'fieldreport.synthesize',
          metadata: { promptVersion: SYNTHESIS_PROMPT_VERSION, model: this.model },
        }) as typeof core)
      : core;
  }

  synthesize(input: SynthesisInput): Promise<SynthesisOutput> {
    return this.run(input);
  }

  private async callModel(userMessage: string): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });
    if ((res.stop_reason as string) === 'refusal') {
      throw new Error('synthesis refused by safety classifier');
    }
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }

  private tryParse(text: string): SynthesisOutput | null {
    try {
      const parsed = SynthesisOutput.safeParse(extractJson(text));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  private async execute(input: SynthesisInput): Promise<SynthesisOutput> {
    const userMessage = buildUserMessage(input);
    let out = this.tryParse(await this.callModel(userMessage));
    if (!out) {
      const repair = `${userMessage}\n\nYour previous reply was not valid JSON of the required shape. Reply again with ONLY the JSON object described above — no prose, no code fence.`;
      out = this.tryParse(await this.callModel(repair));
    }
    if (!out) throw new Error('synthesis: model did not return parseable JSON');
    return this.reconcile(out, input);
  }

  /** Guarantee one output per input id, in order (never drop or invent observations). */
  private reconcile(out: SynthesisOutput, input: SynthesisInput): SynthesisOutput {
    const byId = new Map(out.observations.map((o) => [o.id, o]));
    const observations = [...input.observations]
      .sort((a, b) => a.order - b.order)
      .map(
        (o) =>
          byId.get(o.id) ?? {
            id: o.id,
            cleanedDescription:
              'Observation recorded; description unavailable and should be reviewed.',
          },
      );
    return { summary: out.summary ?? '', observations };
  }
}

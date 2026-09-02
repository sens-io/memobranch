import type { MemoryKind, ProposedMemory, Scope, Sensitivity } from './types.js';
import { memoryKinds, scopes, sensitivities } from './types.js';

interface LlmOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

interface ExtractionDefaults {
  scope: Scope;
  sensitivity: Sensitivity;
}

export class LlmClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;

  constructor(options: LlmOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.AMEM_LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.apiKey = options.apiKey ?? process.env.AMEM_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
    this.model = options.model ?? process.env.AMEM_LLM_MODEL ?? 'gpt-4.1-mini';
  }

  get configured(): boolean {
    return this.apiKey.length > 0 && this.model.length > 0;
  }

  async extractMemories(content: string, defaults: ExtractionDefaults): Promise<ProposedMemory[]> {
    if (!this.configured) {
      throw new Error('LLM is not configured. Set AMEM_LLM_API_KEY and optionally AMEM_LLM_MODEL/AMEM_LLM_BASE_URL.');
    }

    const system = [
      'You extract durable candidate memories for an AI agent.',
      'Return JSON only: {"memories": [...]} and no prose.',
      'Do not treat transient task state, secrets, passwords, tokens, or unverified guesses as durable memory.',
      'Keep statements atomic. Preserve conditions and expiry. A single anecdote cannot become a general procedure.',
      'Allowed kind: preference, fact, episode, procedure, decision.',
      'Allowed scope: user, project, team, public.',
      'Allowed sensitivity: public, internal, sensitive, secret.',
      'confidence is 0..1. explicit is true only when the source explicitly asks the agent to remember it.',
    ].join(' ');
    const user = JSON.stringify({ defaults, source: content });
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 1_000);
      throw new Error(`LLM request failed (${response.status}): ${details}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) throw new Error('LLM returned no content');
    const parsed = parseJsonObject(raw);
    const memories = Array.isArray(parsed.memories) ? parsed.memories : [];
    return memories.map((item) => validateProposal(item, defaults));
  }

  async answer(question: string, context: string): Promise<string> {
    if (!this.configured) {
      throw new Error('LLM is not configured. Set AMEM_LLM_API_KEY and optionally AMEM_LLM_MODEL/AMEM_LLM_BASE_URL.');
    }
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content:
              'Answer only from the supplied memory context. Cite supporting paths in square brackets. If evidence is insufficient or conflicted, say so explicitly.',
          },
          { role: 'user', content: `Question:\n${question}\n\nMemory context:\n${context}` },
        ],
      }),
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 1_000);
      throw new Error(`LLM request failed (${response.status}): ${details}`);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = payload.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('LLM returned no answer');
    return answer;
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const unwrapped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const value = JSON.parse(unwrapped) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('LLM response is not an object');
  return value as Record<string, unknown>;
}

function validateProposal(value: unknown, defaults: ExtractionDefaults): ProposedMemory {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid memory proposal');
  const item = value as Record<string, unknown>;
  const kind = allowed(item.kind, memoryKinds, 'fact');
  const scope = allowed(item.scope, scopes, defaults.scope);
  const sensitivity = allowed(item.sensitivity, sensitivities, defaults.sensitivity);
  const statement = requiredString(item.statement, 'statement');
  const key = typeof item.key === 'string' && item.key.trim() ? item.key.trim() : deriveKey(kind, statement);
  const confidence = Math.max(0, Math.min(1, Number(item.confidence ?? 0.5)));
  const proposal: ProposedMemory = {
    kind,
    key,
    statement,
    scope,
    sensitivity,
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    explicit: item.explicit === true,
    conditions: stringArray(item.conditions),
    tags: stringArray(item.tags),
  };
  if (typeof item.expiresAt === 'string' && !Number.isNaN(Date.parse(item.expiresAt))) {
    proposal.expiresAt = new Date(item.expiresAt).toISOString();
  }
  return proposal;
}

function allowed<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === 'string' && choices.includes(value as T) ? (value as T) : fallback;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`LLM memory is missing ${name}`);
  return value.trim();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean))];
}

function deriveKey(kind: MemoryKind, statement: string): string {
  return `${kind}:${statement.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80)}`;
}

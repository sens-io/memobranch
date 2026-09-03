import type { MemoryKind, ProposedMemory, Scope, Sensitivity } from './types.js';
import { memoryKinds, sensitivities } from './types.js';
import { AgentMemoryError } from './errors.js';
import { sensitivityRank } from './policy.js';

interface LlmOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  embeddingModel?: string;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
  maxRetries?: number;
}

interface ExtractionDefaults {
  scope: Scope;
  sensitivity: Sensitivity;
}

export class LlmClient {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly embeddingModel: string;
  readonly requestTimeoutMs: number;
  readonly maxResponseBytes: number;
  readonly maxRetries: number;
  private readonly pending = new Set<AbortController>();

  constructor(options: LlmOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.AMEM_LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.apiKey = options.apiKey ?? process.env.AMEM_LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? '';
    this.model = options.model ?? process.env.AMEM_LLM_MODEL ?? 'gpt-4.1-mini';
    this.embeddingModel = options.embeddingModel ?? process.env.AMEM_EMBEDDING_MODEL ?? '';
    this.requestTimeoutMs = bounded(options.requestTimeoutMs ?? Number(process.env.AMEM_LLM_TIMEOUT_MS ?? 30_000), 100, 300_000, 30_000);
    this.maxResponseBytes = bounded(options.maxResponseBytes ?? Number(process.env.AMEM_LLM_MAX_RESPONSE_BYTES ?? 2_000_000), 1_024, 20_000_000, 2_000_000);
    this.maxRetries = bounded(options.maxRetries ?? Number(process.env.AMEM_LLM_MAX_RETRIES ?? 1), 0, 4, 1);
  }

  get configured(): boolean {
    return this.apiKey.length > 0 && this.model.length > 0;
  }

  get embeddingConfigured(): boolean {
    return this.apiKey.length > 0 && this.embeddingModel.length > 0;
  }

  canEmbed(model?: string | null): boolean {
    return this.apiKey.length > 0 && Boolean(model || this.embeddingModel);
  }

  cancelPending(): void {
    for (const controller of this.pending) controller.abort();
  }

  async embed(inputs: string[], model = this.embeddingModel): Promise<number[][]> {
    if (!this.apiKey || !model) throw new Error('Embeddings are not configured. Set an embedding model and API key.');
    if (inputs.length === 0) return [];
    if (inputs.length > 32 || inputs.some((input) => input.length > 16_000)) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'Embedding request exceeds the configured batch bounds');
    const payload = await this.requestJson('/embeddings', { model, input: inputs }) as { data?: Array<{ index?: number; embedding?: number[] }> };
    const ordered = [...(payload.data ?? [])].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
    if (ordered.length !== inputs.length || ordered.some((entry) =>
      !Array.isArray(entry.embedding) || entry.embedding.length === 0 || entry.embedding.length > 32_768 || entry.embedding.some((value) => !Number.isFinite(value)),
    )) {
      throw new Error('Embedding response has an invalid vector count');
    }
    return ordered.map((entry) => entry.embedding!);
  }

  async extractMemories(content: string, defaults: ExtractionDefaults): Promise<ProposedMemory[]> {
    if (!this.configured) {
      throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'LLM is not configured. Set AMEM_LLM_API_KEY and optionally AMEM_LLM_MODEL/AMEM_LLM_BASE_URL.');
    }
    if (content.length > 1_000_000) throw new AgentMemoryError('CONTENT_TOO_LARGE', 'LLM extraction input is too large');

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
    const payload = await this.requestJson('/chat/completions', {
      model: this.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) throw new Error('LLM returned no content');
    const parsed = parseJsonObject(raw);
    const memories = Array.isArray(parsed.memories) ? parsed.memories.slice(0, 100) : [];
    return memories.map((item) => validateProposal(item, defaults));
  }

  async answer(question: string, context: string): Promise<string> {
    if (!this.configured) {
      throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'LLM is not configured. Set AMEM_LLM_API_KEY and optionally AMEM_LLM_MODEL/AMEM_LLM_BASE_URL.');
    }
    const payload = await this.requestJson('/chat/completions', {
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
    }) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const answer = payload.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('LLM returned no answer');
    return answer;
  }

  private async requestJson(path: string, payload: object): Promise<unknown> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      timer.unref();
      this.pending.add(controller);
      try {
        const response = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        if (!response.ok) {
          if ((response.status === 429 || response.status >= 500) && attempt < this.maxRetries) continue;
          throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', `LLM request failed with HTTP ${response.status}`);
        }
        return await boundedJson(response, this.maxResponseBytes);
      } catch (error) {
        if (error instanceof AgentMemoryError) throw error;
        if (attempt < this.maxRetries && !controller.signal.aborted) continue;
        const reason = controller.signal.aborted ? 'timed out or was cancelled' : 'failed';
        throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', `LLM request ${reason}`);
      } finally {
        clearTimeout(timer);
        this.pending.delete(controller);
      }
    }
    throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'LLM request failed');
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
  // Model output is advisory. Extracted knowledge inherits the source audience,
  // and may raise (but never lower) the source sensitivity.
  const scope = defaults.scope;
  const proposedSensitivity = allowed(item.sensitivity, sensitivities, defaults.sensitivity);
  const sensitivity = sensitivityRank[proposedSensitivity] > sensitivityRank[defaults.sensitivity]
    ? proposedSensitivity
    : defaults.sensitivity;
  const statement = requiredString(item.statement, 'statement', 1_000_000);
  const key = typeof item.key === 'string' && item.key.trim() ? item.key.trim().slice(0, 512) : deriveKey(kind, statement);
  const confidence = Math.max(0, Math.min(1, Number(item.confidence ?? 0.5)));
  const proposal: ProposedMemory = {
    kind,
    key,
    statement,
    scope,
    sensitivity,
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    explicit: item.explicit === true,
    conditions: stringArray(item.conditions, 100, 2_000),
    tags: stringArray(item.tags, 100, 200),
  };
  if (typeof item.expiresAt === 'string' && !Number.isNaN(Date.parse(item.expiresAt))) {
    proposal.expiresAt = new Date(item.expiresAt).toISOString();
  }
  return proposal;
}

function allowed<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  return typeof value === 'string' && choices.includes(value as T) ? (value as T) : fallback;
}

function requiredString(value: unknown, name: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`LLM memory is missing ${name}`);
  const result = value.trim();
  if (result.length > maximum) throw new Error(`LLM memory ${name} is too large`);
  return result;
}

function stringArray(value: unknown, maximumItems: number, maximumLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().slice(0, maximumLength))
    .filter(Boolean))].slice(0, maximumItems);
}

function deriveKey(kind: MemoryKind, statement: string): string {
  return `${kind}:${statement.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80)}`;
}

async function boundedJson(response: Response, maximumBytes: number): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximumBytes) throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'LLM response exceeded the configured size limit');
  if (!response.body) return JSON.parse(await response.text()) as unknown;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new AgentMemoryError('DEPENDENCY_UNAVAILABLE', 'LLM response exceeded the configured size limit');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')) as unknown;
}

function bounded(value: number, minimum: number, maximum: number, fallback: number): number {
  return Number.isFinite(value) && value >= minimum && value <= maximum ? Math.floor(value) : fallback;
}

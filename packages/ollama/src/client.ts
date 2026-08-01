/**
 * Ollama client (R10, AD-08, AD-18).
 *
 * Everything text-understanding in this project goes through here, and nowhere else.
 * There is no cloud LLM code path in the repository.
 *
 * What makes this reliable rather than merely functional:
 *   - structured output: a JSON Schema is sent as `format`, so the model is constrained
 *     rather than asked politely, and the response is validated with the same zod schema
 *   - determinism: temperature 0 and a fixed seed, so two runs produce the same labels
 *   - right-sized inference: num_ctx and num_predict are set from config, not defaults
 *   - keep_alive: the model stays resident between calls, which is worth roughly an
 *     order of magnitude across thousands of short requests
 *   - retries with jittered backoff on transport and 5xx/429, never on a schema violation
 *   - a repair path for the rare response wrapped in prose
 */
import type { z } from 'zod';
import { ClassificationError, withRetry, type Logger, type RetryOptions } from '@oc/core';

import { cacheKey, createNullCache, type Cache } from './cache.js';

export interface OllamaClientOptions {
  host: string;
  model: string;
  numCtx: number;
  numPredict: number;
  keepAlive: string;
  timeoutMs: number;
  seed?: number;
  cache?: Cache;
  logger?: Logger;
  retry?: RetryOptions;
  fetchImpl?: typeof fetch;
}

export interface GenerateRequest<T> {
  /** Stable identifier for the prompt template, stored alongside every result. */
  promptVersion: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** JSON Schema handed to Ollama's `format` so generation is constrained. */
  jsonSchema: Record<string, unknown>;
  model?: string;
}

export interface GenerateResult<T> {
  value: T;
  model: string;
  promptVersion: string;
  cached: boolean;
  durationMs: number;
  /** Absent for cache hits and for servers that omit timing fields. */
  metrics?: OllamaMetrics;
}

/**
 * Server-reported timings. Ollama returns nanoseconds; we convert once, here.
 *
 * These are what make a throughput claim measurable rather than anecdotal:
 * `evalTokensPerSecond` is the number that decides how long a 2,000-item
 * classification run will take, and `loadDurationMs` is the model-load cost that
 * silently inflates the first request of every batch.
 */
export interface OllamaMetrics {
  totalDurationMs: number;
  loadDurationMs: number;
  promptEvalCount: number;
  promptEvalDurationMs: number;
  evalCount: number;
  evalDurationMs: number;
  evalTokensPerSecond: number;
}

interface OllamaChatResponse {
  message?: { content?: string };
  error?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

const NS_PER_MS = 1e6;

function readMetrics(body: OllamaChatResponse): OllamaMetrics | undefined {
  if (body.eval_count === undefined || body.eval_duration === undefined) return undefined;
  const evalDurationMs = body.eval_duration / NS_PER_MS;
  return {
    totalDurationMs: (body.total_duration ?? 0) / NS_PER_MS,
    loadDurationMs: (body.load_duration ?? 0) / NS_PER_MS,
    promptEvalCount: body.prompt_eval_count ?? 0,
    promptEvalDurationMs: (body.prompt_eval_duration ?? 0) / NS_PER_MS,
    evalCount: body.eval_count,
    evalDurationMs,
    evalTokensPerSecond: evalDurationMs > 0 ? (body.eval_count / evalDurationMs) * 1000 : 0,
  };
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Pulls the first balanced JSON object out of a response wrapped in prose. */
export function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf('{');
  if (start === -1) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

export class OllamaClient {
  private readonly cache: Cache;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OllamaClientOptions) {
    this.cache = options.cache ?? createNullCache();
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  get cacheStats(): { hits: number; misses: number } {
    return { hits: this.cache.hits, misses: this.cache.misses };
  }

  /** Verifies the daemon is reachable and the model is pulled. Run before any batch. */
  async health(): Promise<{ ok: boolean; models: string[]; detail?: string }> {
    try {
      const res = await this.fetchImpl(`${this.options.host}/api/tags`, {
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      if (!res.ok) return { ok: false, models: [], detail: `HTTP ${res.status}` };
      const body = (await res.json()) as { models?: Array<{ name?: string }> };
      const models = (body.models ?? []).map((m) => m.name ?? '').filter(Boolean);
      const present = models.some(
        (m) => m === this.options.model || m.startsWith(`${this.options.model}:`),
      );
      return present
        ? { ok: true, models }
        : {
            ok: false,
            models,
            detail: `model "${this.options.model}" is not pulled. Run: ollama pull ${this.options.model}`,
          };
    } catch (cause) {
      return {
        ok: false,
        models: [],
        detail: `cannot reach Ollama at ${this.options.host} - is \`ollama serve\` running? (${String(cause)})`,
      };
    }
  }

  async generate<T>(request: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const model = request.model ?? this.options.model;
    const key = cacheKey({ model, promptVersion: request.promptVersion, input: request.prompt });

    const hit = this.cache.get<T>(key);
    if (hit !== undefined) {
      const parsed = request.schema.safeParse(hit);
      if (parsed.success) {
        return {
          value: parsed.data,
          model,
          promptVersion: request.promptVersion,
          cached: true,
          durationMs: 0,
        };
      }
      // A cached value that no longer satisfies the schema means the schema moved on.
      this.options.logger?.debug({ key }, 'cache entry rejected by current schema, refetching');
    }

    const startedAt = Date.now();
    const { content, metrics } = await withRetry(() => this.call(request, model), {
      ...this.options.retry,
      onRetry: (attempt, delayMs, error) =>
        this.options.logger?.warn(
          { attempt, delayMs, err: error.message, model },
          'retrying Ollama call',
        ),
    });

    const value = this.parse(content, request);
    this.cache.set(key, value);
    return {
      value,
      model,
      promptVersion: request.promptVersion,
      cached: false,
      durationMs: Date.now() - startedAt,
      ...(metrics ? { metrics } : {}),
    };
  }

  private async call<T>(
    request: GenerateRequest<T>,
    model: string,
  ): Promise<{ content: string; metrics: OllamaMetrics | undefined }> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.options.host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs),
        body: JSON.stringify({
          model,
          stream: false,
          keep_alive: this.options.keepAlive,
          format: request.jsonSchema,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.prompt },
          ],
          options: {
            temperature: 0,
            seed: this.options.seed ?? 42,
            num_ctx: this.options.numCtx,
            num_predict: this.options.numPredict,
          },
        }),
      });
    } catch (cause) {
      // Transport failures and timeouts are worth another attempt.
      throw new ClassificationError('Ollama request failed', {
        cause,
        retryable: true,
        context: { host: this.options.host, model },
      });
    }

    if (!res.ok) {
      throw new ClassificationError(`Ollama returned HTTP ${res.status}`, {
        retryable: RETRYABLE_STATUS.has(res.status),
        context: { status: res.status, model },
      });
    }

    const body = (await res.json()) as OllamaChatResponse;
    if (body.error) {
      throw new ClassificationError(`Ollama error: ${body.error}`, {
        retryable: false,
        context: { model },
      });
    }
    const content = body.message?.content;
    if (!content) {
      throw new ClassificationError('Ollama returned an empty message', {
        retryable: true,
        context: { model },
      });
    }
    return { content, metrics: readMetrics(body) };
  }

  private parse<T>(raw: string, request: GenerateRequest<T>): T {
    const candidates = [raw, extractJsonObject(raw)].filter(
      (c): c is string => typeof c === 'string',
    );
    for (const candidate of candidates) {
      try {
        const parsed = request.schema.safeParse(JSON.parse(candidate));
        if (parsed.success) return parsed.data;
      } catch {
        /* try the next candidate */
      }
    }
    // Not retryable: the model answered, it simply answered wrongly. Retrying an
    // identical deterministic request would produce an identical wrong answer.
    throw new ClassificationError('Ollama response did not satisfy the schema', {
      retryable: false,
      context: { promptVersion: request.promptVersion, sample: raw.slice(0, 300) },
    });
  }
}

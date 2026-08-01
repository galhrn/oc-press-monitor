import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ClassificationError } from '@oc/core';
import { OllamaClient, createLimiter, createNullCache, extractJsonObject } from '@oc/ollama';

const Schema = z.object({ sentiment: z.enum(['positive', 'negative', 'neutral']) });
const JSON_SCHEMA = { type: 'object', properties: { sentiment: { type: 'string' } } };

/** A fake Ollama daemon. Tests never touch the network or a real model. */
function fakeOllama(handler: (body: unknown) => { status?: number; json: unknown }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }), { status: 200 });
    }
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const { status = 200, json } = handler(body);
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch;
}

const client = (
  fetchImpl: typeof fetch,
  over: Partial<ConstructorParameters<typeof OllamaClient>[0]> = {},
) =>
  new OllamaClient({
    host: 'http://127.0.0.1:11434',
    model: 'llama3.2:3b',
    numCtx: 1024,
    numPredict: 96,
    keepAlive: '30m',
    timeoutMs: 5_000,
    cache: createNullCache(),
    retry: { attempts: 3, baseDelayMs: 0, sleep: async () => undefined, random: () => 0 },
    fetchImpl,
    ...over,
  });

const ok = (content: unknown) => () => ({
  json: { message: { content: JSON.stringify(content) } },
});

describe('OllamaClient.generate', () => {
  const req = {
    promptVersion: 'test.v1',
    system: 'sys',
    prompt: 'classify this',
    schema: Schema,
    jsonSchema: JSON_SCHEMA,
  };

  it('returns a schema-validated value', async () => {
    const result = await client(fakeOllama(ok({ sentiment: 'positive' }))).generate(req);
    expect(result.value.sentiment).toBe('positive');
    expect(result.cached).toBe(false);
  });

  it('sends deterministic options and the JSON schema as `format` (AD-08, AD-18)', async () => {
    const seen: Record<string, unknown>[] = [];
    await client(
      fakeOllama((body) => {
        seen.push(body as Record<string, unknown>);
        return ok({ sentiment: 'neutral' })();
      }),
    ).generate(req);

    const sent = seen[0] as {
      options: Record<string, number>;
      format: unknown;
      keep_alive: string;
    };
    expect(sent.options.temperature).toBe(0);
    expect(sent.options.seed).toBe(42);
    expect(sent.options.num_ctx).toBe(1024);
    expect(sent.options.num_predict).toBe(96);
    expect(sent.keep_alive).toBe('30m');
    expect(sent.format).toEqual(JSON_SCHEMA);
  });

  it('repairs a response wrapped in prose', async () => {
    const fetchImpl = fakeOllama(() => ({
      json: { message: { content: 'Sure! Here you go:\n```json\n{"sentiment":"negative"}\n```' } },
    }));
    expect((await client(fetchImpl).generate(req)).value.sentiment).toBe('negative');
  });

  it('retries a 503 and then succeeds', async () => {
    let calls = 0;
    const fetchImpl = fakeOllama(() => {
      calls += 1;
      return calls === 1 ? { status: 503, json: {} } : ok({ sentiment: 'positive' })();
    });
    expect((await client(fetchImpl).generate(req)).value.sentiment).toBe('positive');
    expect(calls).toBe(2);
  });

  it('does not retry a schema violation - a deterministic call would fail identically', async () => {
    let calls = 0;
    const fetchImpl = fakeOllama(() => {
      calls += 1;
      return ok({ sentiment: 'ecstatic' })();
    });
    await expect(client(fetchImpl).generate(req)).rejects.toBeInstanceOf(ClassificationError);
    expect(calls).toBe(1);
  });

  it('serves a second identical call from cache', async () => {
    let calls = 0;
    const store = new Map<string, unknown>();
    const cache = {
      get: <T>(k: string) => store.get(k) as T | undefined,
      set: <T>(k: string, v: T) => void store.set(k, v),
      hits: 0,
      misses: 0,
    };
    const fetchImpl = fakeOllama(() => {
      calls += 1;
      return ok({ sentiment: 'neutral' })();
    });
    const c = client(fetchImpl, { cache });
    await c.generate(req);
    const second = await c.generate(req);
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
  });
});

describe('OllamaClient.health', () => {
  it('reports a missing model with the exact command to fix it', async () => {
    const c = client(fakeOllama(ok({})), { model: 'qwen2.5:1.5b' });
    const health = await c.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('ollama pull qwen2.5:1.5b');
  });

  it('reports an unreachable daemon rather than throwing', async () => {
    const c = client((() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch);
    const health = await c.health();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('ollama serve');
  });
});

describe('extractJsonObject', () => {
  it('finds a balanced object inside surrounding text', () => {
    expect(extractJsonObject('noise {"a":{"b":1}} trailing')).toBe('{"a":{"b":1}}');
  });

  it('ignores braces inside strings', () => {
    expect(extractJsonObject('{"a":"}"}')).toBe('{"a":"}"}');
  });

  it('returns undefined when there is no object', () => {
    expect(extractJsonObject('nothing here')).toBeUndefined();
  });
});

describe('createLimiter', () => {
  it('never runs more than `concurrency` tasks at once', async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        limit(async () => {
          active += 1;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 1));
          active -= 1;
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });

  it('releases its slot when a task throws', async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(limit(async () => 'recovered')).resolves.toBe('recovered');
  });
});

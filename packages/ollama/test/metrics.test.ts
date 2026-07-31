import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { OllamaClient, createNullCache } from '@oc/ollama';

const Schema = z.object({ ok: z.boolean() });

/** Ollama reports timings in nanoseconds; the client must convert exactly once. */
const withTimings = (over: Record<string, number> = {}): typeof fetch =>
  (async (url: string | URL | Request) => {
    if (String(url).endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'm' }] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        message: { content: '{"ok":true}' },
        total_duration: 2_500_000_000,
        load_duration: 1_000_000_000,
        prompt_eval_count: 120,
        prompt_eval_duration: 300_000_000,
        eval_count: 80,
        eval_duration: 2_000_000_000,
        ...over,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

const make = (fetchImpl: typeof fetch) =>
  new OllamaClient({
    host: 'http://127.0.0.1:11434',
    model: 'm',
    numCtx: 1024,
    numPredict: 96,
    keepAlive: '30m',
    timeoutMs: 5_000,
    cache: createNullCache(),
    fetchImpl,
  });

const req = {
  promptVersion: 'v1',
  system: 's',
  prompt: 'p',
  schema: Schema,
  jsonSchema: { type: 'object' },
};

describe('server-reported metrics', () => {
  it('converts nanoseconds to milliseconds and derives tokens/sec', async () => {
    const { metrics } = await make(withTimings()).generate(req);
    expect(metrics?.totalDurationMs).toBe(2500);
    expect(metrics?.loadDurationMs).toBe(1000);
    expect(metrics?.evalCount).toBe(80);
    expect(metrics?.evalDurationMs).toBe(2000);
    // 80 tokens in 2s
    expect(metrics?.evalTokensPerSecond).toBeCloseTo(40, 5);
  });

  it('omits metrics rather than reporting zeros when the server sends no timings', async () => {
    const bare = (async (url: string | URL | Request) => {
      if (String(url).endsWith('/api/tags')) {
        return new Response(JSON.stringify({ models: [{ name: 'm' }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: { content: '{"ok":true}' } }), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await make(bare).generate(req)).metrics).toBeUndefined();
  });

  it('never divides by zero when eval_duration is zero', async () => {
    const { metrics } = await make(withTimings({ eval_duration: 0 })).generate(req);
    expect(metrics?.evalTokensPerSecond).toBe(0);
  });
});

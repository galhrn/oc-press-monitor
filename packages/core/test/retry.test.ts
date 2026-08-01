import { describe, expect, it, vi } from 'vitest';
import { ProviderError, withRetry } from '@oc/core';

describe('withRetry', () => {
  it('gives up immediately on a non-retryable error', async () => {
    const fn = vi.fn(async () => {
      throw new ProviderError('bad schema', { retryable: false });
    });
    await expect(withRetry(fn, { attempts: 5, sleep: async () => undefined })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops after the configured number of attempts', async () => {
    const fn = vi.fn(async () => {
      throw new ProviderError('flaky', { retryable: true });
    });
    await expect(
      withRetry(fn, { attempts: 3, baseDelayMs: 0, sleep: async () => undefined, random: () => 0 }),
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

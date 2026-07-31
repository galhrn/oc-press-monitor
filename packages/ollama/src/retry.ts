/** Exponential backoff with full jitter. Only ever applied to errors marked retryable. */
import { isRetryable, toError } from '@oc/core';

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, error: Error) => void;
  /** Injectable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    onRetry,
    sleep = defaultSleep,
    random = Math.random,
  } = options;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (thrown) {
      lastError = toError(thrown);
      if (attempt === attempts || !isRetryable(thrown)) throw lastError;
      // Full jitter spreads a herd of 258 companies out instead of synchronising
      // every retry onto the same instant.
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.floor(random() * ceiling);
      onRetry?.(attempt, delay, lastError);
      await sleep(delay);
    }
  }
  throw lastError ?? new Error('withRetry exhausted without an error');
}

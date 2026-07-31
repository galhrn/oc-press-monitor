/**
 * Minimal concurrency limiter (AD-18).
 *
 * On a bandwidth-bound iGPU the optimal number of in-flight Ollama requests is small -
 * usually 2 to 4 - and going wider makes the whole run slower. Dependency-free because
 * the behaviour needed is twenty lines and one more supply-chain entry is not worth it.
 */
export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

export function createLimiter(concurrency: number): Limiter {
  if (concurrency < 1) throw new RangeError('concurrency must be >= 1');
  let active = 0;
  const queue: Array<() => void> = [];

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => queue.push(resolve));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

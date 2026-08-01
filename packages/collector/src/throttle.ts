/**
 * Per-provider request spacing (P3.2, P3.7).
 *
 * Extracted when the second provider needed it. The thing being protected is the *remote
 * service*, not our own event loop, so the throttle belongs to a provider instance rather
 * than to a run: two providers should not have to share a budget neither of them set.
 *
 * Requests are queued behind one another and separated by at least `minIntervalMs`. The
 * queue deliberately survives a failed task - a broken chain would strand every later
 * company behind the first error.
 */
export interface ThrottleOptions {
  minIntervalMs: number;
  /** Injectable so tests never wait in real time. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export type Throttle = <T>(task: () => Promise<T>) => Promise<T>;

export function createThrottle(options: ThrottleOptions): Throttle {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let chain: Promise<unknown> = Promise.resolve();
  let lastStartedAt = 0;

  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(async () => {
      const wait = lastStartedAt + options.minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastStartedAt = now();
      return task();
    });
    chain = run.catch(() => undefined);
    return run;
  };
}

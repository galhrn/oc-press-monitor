/**
 * Per-provider circuit breaker (task P3.7, requirement R26).
 *
 * A run touches 258 companies across two providers. When a provider goes down, the naive
 * behaviour is to discover that 258 times - each with its own retries and backoff - which
 * turns a five-minute outage into an hour of waiting for failures we already knew about.
 *
 * After `failureThreshold` consecutive failures the circuit opens and that provider is
 * skipped until `cooldownMs` has passed, then a single probe decides whether to close it.
 * The breaker is per provider, because GDELT being rate-limited says nothing about whether
 * Google News is up - which is exactly the situation this project is actually in.
 */
export const CIRCUIT_STATES = ['closed', 'open', 'half-open'] as const;
export type CircuitState = (typeof CIRCUIT_STATES)[number];

export interface CircuitBreakerOptions {
  /** Consecutive failures before the circuit opens. */
  failureThreshold?: number;
  /**
   * How long an open circuit waits before allowing a probe. Five minutes rather than one:
   * the GDELT block observed on 2026-08-02 outlasted a 75-second pause by hours, so a
   * short cooldown just spends requests confirming what we already know.
   */
  cooldownMs?: number;
  now?: () => number;
}

interface ProviderCircuit {
  failures: number;
  openedAt: number | null;
}

export interface CircuitBreaker {
  /** False when the provider should be skipped entirely for this attempt. */
  canAttempt(provider: string): boolean;
  state(provider: string): CircuitState;
  recordSuccess(provider: string): void;
  /**
   * `immediate` trips the circuit on a single failure, for a response that explicitly says
   * "stop" - a 429 is not a flaky error to be retried past, it is an instruction.
   */
  recordFailure(provider: string, options?: { immediate?: boolean }): void;
  snapshot(): Record<string, { state: CircuitState; failures: number }>;
}

export function createCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreaker {
  const failureThreshold = options.failureThreshold ?? 3;
  const cooldownMs = options.cooldownMs ?? 300_000;
  const now = options.now ?? Date.now;
  const circuits = new Map<string, ProviderCircuit>();

  const get = (provider: string): ProviderCircuit => {
    let circuit = circuits.get(provider);
    if (circuit === undefined) {
      circuit = { failures: 0, openedAt: null };
      circuits.set(provider, circuit);
    }
    return circuit;
  };

  const state = (provider: string): CircuitState => {
    const circuit = get(provider);
    if (circuit.openedAt === null) return 'closed';
    return now() - circuit.openedAt >= cooldownMs ? 'half-open' : 'open';
  };

  return {
    state,
    canAttempt: (provider) => state(provider) !== 'open',
    recordSuccess: (provider) => {
      const circuit = get(provider);
      circuit.failures = 0;
      circuit.openedAt = null;
    },
    recordFailure: (provider, opts) => {
      const circuit = get(provider);
      circuit.failures += 1;
      // A failed probe in half-open restarts the cooldown rather than opening a new one.
      if (opts?.immediate === true || circuit.failures >= failureThreshold) {
        circuit.openedAt = now();
      }
    },
    snapshot: () =>
      Object.fromEntries(
        [...circuits.entries()].map(([provider, circuit]) => [
          provider,
          { state: state(provider), failures: circuit.failures },
        ]),
      ),
  };
}

/**
 * Typed error hierarchy.
 *
 * Every failure in this system answers three questions before it is thrown:
 *   - what kind of failure is it        -> the subclass
 *   - is retrying plausibly useful      -> `retryable`
 *   - what context does a human need    -> `context`
 *
 * Call sites branch on `retryable`, never on message strings.
 */

export type ErrorContext = Record<string, unknown>;

export abstract class AppError extends Error {
  abstract readonly code: string;
  /** True when the same call could plausibly succeed if repeated. */
  readonly retryable: boolean;
  readonly context: ErrorContext;

  constructor(
    message: string,
    options: { retryable?: boolean; context?: ErrorContext; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.retryable = options.retryable ?? false;
    this.context = options.context ?? {};
    Error.captureStackTrace?.(this, new.target);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

/** Invalid or missing configuration. Never retryable - the process should refuse to start. */
export class ConfigError extends AppError {
  readonly code = 'E_CONFIG';
}

/** A news provider failed. Retryable for transport/5xx/429, not for malformed responses. */
export class ProviderError extends AppError {
  readonly code = 'E_PROVIDER';
}

/** The Ollama call failed, timed out, or returned output that could not be repaired into the schema. */
export class ClassificationError extends AppError {
  readonly code = 'E_CLASSIFICATION';
}

/** Storage-layer failure. */
export class StorageError extends AppError {
  readonly code = 'E_STORAGE';
}

/** An alert sink failed to deliver. Never fatal to a run - alerts are recorded regardless. */
export class AlertError extends AppError {
  readonly code = 'E_ALERT';
}

/** Data that reached a boundary in a shape the domain does not allow. */
export class ValidationError extends AppError {
  readonly code = 'E_VALIDATION';
}

export function isRetryable(err: unknown): boolean {
  return err instanceof AppError && err.retryable;
}

/** Normalises anything thrown into an Error, so logging never has to guess. */
export function toError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  return new Error(typeof thrown === 'string' ? thrown : JSON.stringify(thrown));
}

/**
 * Structured logging (AD-15).
 *
 * JSON in production so a run is machine-readable; pretty in development so it is
 * human-readable. Child loggers carry `runId` / `companyId` so a single company's
 * path through a 258-company run can be isolated with one grep.
 */
import pino, { type Logger } from 'pino';
import { getConfig } from './config.js';

export type { Logger };

let root: Logger | undefined;

function build(): Logger {
  const cfg = getConfig();
  const pretty = cfg.NODE_ENV === 'development';
  return pino({
    level: cfg.LOG_LEVEL,
    base: { service: 'oc-press-monitor' },
    redact: { paths: ['req.headers.authorization', 'SLACK_WEBHOOK_URL'], censor: '[redacted]' },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
          },
        }
      : {}),
  });
}

export function getLogger(): Logger {
  root ??= build();
  return root;
}

/** A logger scoped to one unit of work. Always prefer this over the root logger. */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return getLogger().child(bindings);
}

/**
 * Alert dispatch (task P5.5, requirements R7, R26).
 *
 * Sits between the daily job and the sinks, and owns the two rules that keep alerting
 * trustworthy.
 *
 * **Delivery is recorded only after it succeeds.** The `alerts` table has
 * `UNIQUE (mention_id, channel)`, so a recorded row means "this went out on this channel".
 * Writing the row first would be simpler, but a sink failing after the write would leave the
 * database claiming an alert was delivered that nobody received - and a monitoring tool that
 * silently drops the one alert that mattered is worse than one that occasionally repeats
 * itself. This is at-least-once delivery, chosen deliberately over at-most-once.
 *
 * **A sink failing never fails the run.** Alerting is the last stage; a broken webhook must
 * not discard a completed collection. Failures are counted and logged, and because nothing
 * was recorded, the next run retries them.
 */
import { toError, type Logger, type Repositories } from '@oc/core';
import type { Alert, Alerter, AlertOutcome } from './types.js';

export interface DispatchOptions {
  alerts: readonly Alert[];
  sinks: readonly Alerter[];
  repositories: Repositories;
  runId: string;
  logger?: Logger;
  /** Reports what would be sent without sending or recording anything. */
  dryRun?: boolean;
}

export interface DispatchSummary {
  candidates: number;
  delivered: number;
  /** Already sent on this channel by an earlier run - the idempotency guarantee at work. */
  skipped: number;
  failed: number;
  outcomes: AlertOutcome[];
}

export async function dispatchAlerts(options: DispatchOptions): Promise<DispatchSummary> {
  const { alerts, sinks, repositories: repos, runId, logger } = options;
  const summary: DispatchSummary = {
    candidates: alerts.length,
    delivered: 0,
    skipped: 0,
    failed: 0,
    outcomes: [],
  };

  for (const sink of sinks) {
    const pending = alerts.filter((alert) => !repos.alerts.wasSent(alert.mentionId, sink.name));
    summary.skipped += alerts.length - pending.length;

    if (pending.length === 0) {
      summary.outcomes.push({ channel: sink.name, delivered: 0, failed: 0 });
      continue;
    }
    if (options.dryRun === true) {
      summary.outcomes.push({ channel: sink.name, delivered: 0, failed: 0 });
      logger?.info({ channel: sink.name, would: pending.length }, 'dry run: nothing sent');
      continue;
    }

    try {
      const outcome = await sink.send(pending);
      summary.outcomes.push(outcome);
      summary.delivered += outcome.delivered;
      summary.failed += outcome.failed;

      if (outcome.delivered > 0) {
        for (const alert of pending) {
          repos.alerts.record({
            runId,
            mentionId: alert.mentionId,
            channel: sink.name,
            payload: alert,
          });
        }
      }
    } catch (thrown) {
      // Nothing recorded, so the next run tries again.
      const error = toError(thrown);
      summary.failed += pending.length;
      summary.outcomes.push({
        channel: sink.name,
        delivered: 0,
        failed: pending.length,
        error: error.message,
      });
      logger?.error({ channel: sink.name, err: error.message }, 'alert sink failed; run continues');
    }
  }

  return summary;
}

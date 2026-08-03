/**
 * Scheduler (task P7.1, requirement R19, decision AD-12).
 *
 * Deliberately thin, and that is the design rather than an omission. The daily check is an
 * **idempotent function** (`runDailyJob`); this file only decides *when* to call it. Cron,
 * a GitHub Action and a systemd timer are then interchangeable, and none of them can
 * introduce a correctness bug that the job itself does not already have.
 *
 * What this wrapper adds over `cron` calling the CLI directly:
 *
 *   - an **explicit timezone**. `0 8 * * *` means nothing without one, and a server that
 *     moves between UTC and local time silently shifts the alert window.
 *   - **boot catch-up**: if the process was down when the schedule fired, run once at start
 *     rather than waiting a full day. Safe precisely because the job is idempotent.
 *   - **overlap protection**, inherited from the job's own lock, so a run that overshoots its
 *     interval cannot be started twice.
 */
import cron, { type ScheduledTask } from 'node-cron';
import { toError, type Logger } from '@oc/core';
import { runDailyJob, type DailyOptions } from '@oc/pipeline';

export interface SchedulerOptions {
  /** Standard five-field cron expression. */
  schedule: string;
  /** IANA zone. Required, not defaulted - an implicit timezone is a bug waiting for DST. */
  timezone: string;
  /** Run once immediately on boot, in case the schedule was missed while down. */
  catchUpOnBoot?: boolean;
  job: () => DailyOptions;
  logger?: Logger;
}

export interface SchedulerHandle {
  task: ScheduledTask;
  stop: () => void;
}

export function startScheduler(options: SchedulerOptions): SchedulerHandle {
  const { schedule, timezone, logger } = options;

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron expression: "${schedule}"`);
  }

  const tick = async (trigger: 'schedule' | 'boot'): Promise<void> => {
    try {
      const summary = await runDailyJob(options.job());
      if (!summary.acquiredLock) {
        logger?.warn(
          { trigger, heldBy: summary.lockHeldBy },
          'skipped: another run holds the lock',
        );
        return;
      }
      logger?.info(
        {
          trigger,
          runId: summary.runId,
          newMentions: summary.newMentions,
          alerted: summary.dispatch?.delivered ?? 0,
        },
        'daily job complete',
      );
    } catch (thrown) {
      // A failed run must never kill the scheduler: tomorrow's check is more valuable than
      // a clean stack trace today.
      logger?.error(
        { trigger, err: toError(thrown).message },
        'daily job failed; scheduler continues',
      );
    }
  };

  const task = cron.schedule(schedule, () => void tick('schedule'), { timezone });
  logger?.info({ schedule, timezone }, 'scheduler started');

  if (options.catchUpOnBoot === true) void tick('boot');

  return { task, stop: () => task.stop() };
}

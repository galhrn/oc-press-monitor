import { describe, expect, it, vi } from 'vitest';
import { startScheduler } from '@oc/scheduler';

/**
 * The scheduler is deliberately thin, so these tests cover exactly what it adds over a bare
 * cron entry: a validated expression, boot catch-up, and surviving a failed run.
 *
 * What it does *not* test is whether the daily job is correct - that lives in
 * `packages/pipeline/test/daily.test.ts`, which is the point of keeping the two separate.
 */
const options = () =>
  ({
    companies: [],
    providers: [],
    repositories: {} as never,
    classify: {} as never,
    alerters: [],
  }) as never;

describe('startScheduler (P7.1)', () => {
  it('refuses an invalid cron expression rather than silently never firing', () => {
    expect(() =>
      startScheduler({ schedule: 'not a cron', timezone: 'Asia/Jerusalem', job: options }),
    ).toThrow(/Invalid cron expression/);
  });

  it('accepts a valid expression and returns a stoppable handle', () => {
    const handle = startScheduler({
      schedule: '0 8 * * *',
      timezone: 'Asia/Jerusalem',
      job: options,
    });
    expect(handle.task).toBeDefined();
    handle.stop();
  });

  it('runs once on boot when asked, so a missed schedule is not a lost day', async () => {
    const job = vi.fn(options);
    const handle = startScheduler({
      schedule: '0 8 * * *',
      timezone: 'Asia/Jerusalem',
      catchUpOnBoot: true,
      job,
    });
    // The boot tick is fire-and-forget; give the microtask queue a turn.
    await new Promise((r) => setTimeout(r, 20));
    expect(job).toHaveBeenCalled();
    handle.stop();
  });

  it('does not run on boot by default', async () => {
    const job = vi.fn(options);
    const handle = startScheduler({ schedule: '0 8 * * *', timezone: 'Asia/Jerusalem', job });
    await new Promise((r) => setTimeout(r, 20));
    expect(job).not.toHaveBeenCalled();
    handle.stop();
  });

  it('survives a failing run - tomorrow matters more than today s stack trace', async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const handle = startScheduler({
      schedule: '0 8 * * *',
      timezone: 'Asia/Jerusalem',
      catchUpOnBoot: true,
      // Throwing while *building* the options is the harshest case: it fails before the job.
      job: () => {
        throw new Error('database unavailable');
      },
      logger: logger as never,
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(logger.error).toHaveBeenCalled();
    // Still scheduled, not dead.
    expect(handle.task).toBeDefined();
    handle.stop();
  });
});

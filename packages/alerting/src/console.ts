/**
 * Console sink (task P5.5).
 *
 * Writes to stderr, not stdout. The daily job's stdout is reserved for machine-readable
 * output (`--json`), and an alert that corrupts a pipe is an alert that breaks the caller.
 */
import type { Logger } from '@oc/core';
import { formatAlertLine, type Alert, type Alerter, type AlertOutcome } from './types.js';

export class ConsoleAlerter implements Alerter {
  readonly name = 'console';

  constructor(private readonly logger?: Logger) {}

  send(alerts: readonly Alert[]): Promise<AlertOutcome> {
    if (alerts.length === 0)
      return Promise.resolve({ channel: this.name, delivered: 0, failed: 0 });

    console.error(`\n  ${alerts.length} new mention${alerts.length === 1 ? '' : 's'}\n`);
    for (const alert of alerts) {
      console.error(`  ${formatAlertLine(alert)}`);
      console.error(`     ${alert.url}`);
      if (alert.rationale !== null && alert.rationale !== '') {
        const confidence =
          alert.confidence === null ? '' : ` (confidence ${alert.confidence.toFixed(2)})`;
        console.error(`     ${alert.rationale}${confidence}`);
      }
    }
    console.error('');

    this.logger?.info({ channel: this.name, count: alerts.length }, 'alerts written to console');
    return Promise.resolve({ channel: this.name, delivered: alerts.length, failed: 0 });
  }
}

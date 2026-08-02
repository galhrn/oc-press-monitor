/**
 * Alerting contract (task P5.5, requirement R7, decision AD-13).
 *
 * The `Alerter` interface is the deliverable, not the number of implementations. Console and
 * file ship because they work with zero configuration - a reviewer sees alerting function
 * without creating an account anywhere - and Slack is cut (OQ-4) precisely because the seam
 * makes it a small addition rather than a rewrite.
 */
import type { Sentiment } from '@oc/core';

/**
 * What a person needs to decide whether to care, in one glance.
 *
 * `rationale` and `confidence` are carried deliberately. The bake-off measured this
 * configuration at 0.52 combined macro-F1 with an irrelevant-recall of 0.24, so some alerts
 * will be about the wrong company entirely. An alert a reader cannot triage without opening
 * the link is an alert they will learn to ignore, and a monitoring tool nobody reads is worse
 * than no monitoring tool.
 */
export interface Alert {
  mentionId: string;
  company: string;
  companySlug: string;
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
  sentiment: Sentiment | null;
  confidence: number | null;
  rationale: string | null;
  model: string | null;
  /** When this run noticed it, which is not the same as when it was published. */
  detectedAt: string;
}

export interface AlertOutcome {
  channel: string;
  delivered: number;
  failed: number;
  error?: string;
}

export interface Alerter {
  /** Stored on the alert row, so "which channels has this been sent to" is answerable. */
  readonly name: string;
  send(alerts: readonly Alert[]): Promise<AlertOutcome>;
}

/** Compact one-line rendering shared by the console sink and the daily job's summary. */
export function formatAlertLine(alert: Alert): string {
  const sentiment = alert.sentiment ?? 'unclassified';
  const date = alert.publishedAt?.slice(0, 10) ?? '—';
  return `${date}  ${sentiment.toUpperCase().padEnd(11)} ${alert.company.padEnd(22)} ${alert.title}`;
}

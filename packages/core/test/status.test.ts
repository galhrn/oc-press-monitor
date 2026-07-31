import { describe, expect, it } from 'vitest';
import { bucketFor, daysSince, describeStatus } from '@oc/core';

const NOW = new Date('2026-07-31T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('daysSince', () => {
  it('returns null when there is no publication date', () => {
    expect(daysSince(null, NOW)).toBeNull();
  });

  it('returns null for an unparseable date rather than NaN', () => {
    expect(daysSince('not-a-date', NOW)).toBeNull();
  });

  it('clamps future dates to zero', () => {
    expect(daysSince(daysAgo(-5), NOW)).toBe(0);
  });

  it.each([0, 1, 7, 30, 90, 365])('counts %i whole days', (n) => {
    expect(daysSince(daysAgo(n), NOW)).toBe(n);
  });
});

describe('bucketFor - boundary conditions (task P5.3)', () => {
  it.each([
    [null, 'NO_COVERAGE'],
    [0, 'FRESH'],
    [7, 'FRESH'],
    [8, 'RECENT'],
    [30, 'RECENT'],
    [31, 'STALE'],
    [90, 'STALE'],
    [91, 'DORMANT'],
    [3650, 'DORMANT'],
  ] as const)('%s days -> %s', (days, expected) => {
    expect(bucketFor(days)).toBe(expected);
  });
});

describe('describeStatus', () => {
  it('treats absence of coverage as a first-class state (R5)', () => {
    expect(describeStatus(null)).toBe('no coverage found');
  });

  it('reads naturally for recent dates', () => {
    expect(describeStatus(0)).toBe('mentioned today');
    expect(describeStatus(1)).toBe('last mentioned yesterday');
    expect(describeStatus(45)).toBe('last mentioned 45 days ago');
  });
});

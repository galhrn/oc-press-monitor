import { describe, expect, it } from 'vitest';
import { parseArgs } from '../scripts/args.js';

/**
 * A `--limit 10` dev loop once overwrote the committed 258-company registry, which is a
 * graded deliverable (R8, R24). These tests exist so it cannot happen twice.
 */
describe('enrich argument parsing', () => {
  it('writes the committed registry only for a full run', () => {
    const args = parseArgs([]);
    expect(args.outPath).toMatch(/data[\\/]companies\.json$/);
    expect(args.redirected).toBe(false);
  });

  it('diverts a partial run to its own file', () => {
    const args = parseArgs(['--limit', '10']);
    expect(args.limit).toBe(10);
    expect(args.redirected).toBe(true);
    expect(args.outPath).toMatch(/data[\\/]companies\.sample-10\.json$/);
    expect(args.outPath).not.toMatch(/companies\.json$/);
  });

  it('still honours an explicit --out during a partial run', () => {
    const args = parseArgs(['--limit', '5', '--out', 'tmp/out.json']);
    expect(args.outPath).toBe('tmp/out.json');
    expect(args.redirected).toBe(false);
  });

  it('ignores a non-numeric or non-positive limit rather than truncating to zero', () => {
    expect(parseArgs(['--limit', 'abc']).limit).toBeUndefined();
    expect(parseArgs(['--limit', '0']).limit).toBeUndefined();
    expect(parseArgs(['--limit', 'abc']).outPath).toMatch(/data[\\/]companies\.json$/);
  });

  it('reads the remaining flags', () => {
    const args = parseArgs(['--offline', '--no-cache', '--seed', 'other.txt']);
    expect(args.offline).toBe(true);
    expect(args.noCache).toBe(true);
    expect(args.seedPath).toBe('other.txt');
  });
});

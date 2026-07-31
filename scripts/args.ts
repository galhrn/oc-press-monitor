/**
 * Argument parsing for `scripts/enrich-companies.ts`, kept in its own module so it can be
 * unit-tested without executing the script.
 */
import { fileURLToPath } from 'node:url';

export interface EnrichArgs {
  offline: boolean;
  noCache: boolean;
  limit?: number;
  seedPath: string;
  outPath: string;
  /** True when `--limit` diverted the output away from the committed registry. */
  redirected: boolean;
}

export function parseArgs(argv: readonly string[]): EnrichArgs {
  const at = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const limitRaw = at('--limit');
  const parsed = limitRaw === undefined ? Number.NaN : Number.parseInt(limitRaw, 10);
  const limit = Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
  const explicitOut = at('--out');

  // `data/companies.json` is a graded deliverable (R8, R24) holding all 258 records.
  // A `--limit` dev loop must never be able to truncate it, so it writes to its own file
  // unless the caller names a destination explicitly.
  const defaultOut = here(
    limit === undefined ? '../data/companies.json' : `../data/companies.sample-${limit}.json`,
  );

  return {
    offline: argv.includes('--offline'),
    noCache: argv.includes('--no-cache'),
    limit,
    seedPath: at('--seed') ?? here('../packages/registry/data/ourcrowd_companies.txt'),
    outPath: explicitOut ?? defaultOut,
    redirected: explicitOut === undefined && limit !== undefined,
  };
}

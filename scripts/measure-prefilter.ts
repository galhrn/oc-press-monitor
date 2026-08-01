/**
 * Pre-filter precision probe (P3.6, P3 exit criteria, R9).
 *
 *   npm run measure:prefilter
 *   npm run measure:prefilter -- --companies Peak,Shield,Kando
 *
 * Runs live Google News queries for a sample of companies and reports how many candidates
 * the deterministic pre-filter removes and why. Section 6.4 predicts it eliminates 40-60%
 * for zero inference cost; this is where that claim is checked rather than asserted.
 *
 * It prints the surviving headlines deliberately. A drop rate on its own says nothing about
 * whether the *right* items were dropped, and reading what survived is the only honest way
 * to see the pre-filter's limits - the LLM relevance gate (AD-06) exists for what remains.
 */
import { readFileSync } from 'node:fs';
import { GoogleNewsProvider, preFilterAll, type PreFilterCompany } from '@oc/collector';

const registry = JSON.parse(
  readFileSync(new URL('../data/companies.json', import.meta.url), 'utf8'),
) as PreFilterCompany[];

const DEFAULT_SAMPLE = [
  'ZutaCore',
  'Peak',
  'Kando',
  'Hailo',
  'Lemonade',
  'Harvey',
  'Morphisec',
  'Shield',
];
const flag = process.argv.indexOf('--companies');
const names =
  flag >= 0 && process.argv[flag + 1]
    ? (process.argv[flag + 1] ?? '').split(',').map((s) => s.trim())
    : DEFAULT_SAMPLE;
const provider = new GoogleNewsProvider();
const from = new Date(Date.now() - 90 * 86_400_000).toISOString();

const totals = { fetched: 0, kept: 0 } as Record<string, number>;
const reasons: Record<string, number> = {};

for (const name of names) {
  const company = registry.find((c) => c.name === name);
  if (!company) continue;
  const items = await provider.search({ query: company.query, from, limit: 25 });
  const result = preFilterAll(items, company);
  totals.fetched = (totals.fetched ?? 0) + items.length;
  totals.kept = (totals.kept ?? 0) + result.kept.length;
  for (const [k, v] of Object.entries(result.stats)) {
    if (k !== 'kept' && v > 0) reasons[k] = (reasons[k] ?? 0) + v;
  }
  console.log(
    `${name.padEnd(11)} fetched ${String(items.length).padStart(2)}  kept ${String(result.kept.length).padStart(2)}  ` +
      Object.entries(result.stats)
        .filter(([k, v]) => k !== 'kept' && v > 0)
        .map(([k, v]) => `${k}:${v}`)
        .join(' '),
  );
  for (const a of result.kept.slice(0, 2))
    console.log(`             KEPT  ${a.title.slice(0, 68)}`);
}

const dropped = (totals.fetched ?? 0) - (totals.kept ?? 0);
console.log(
  `\nTOTAL fetched ${totals.fetched}  kept ${totals.kept}  dropped ${dropped} ` +
    `(${Math.round((dropped / Math.max(1, totals.fetched ?? 1)) * 100)}%)`,
);
console.log('reasons:', JSON.stringify(reasons));

/** Zero-coverage baseline across the 57 human-approved companies (R9, P5 NO_COVERAGE). */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  GoogleNewsProvider,
  buildSearchQuery,
  preFilterAll,
  type PreFilterCompany,
} from '@oc/collector';

const registry = JSON.parse(
  readFileSync(new URL('../data/companies.json', import.meta.url), 'utf8'),
) as Array<PreFilterCompany & { querySource: string; ambiguity: string }>;

const approved = registry.filter((c) => c.querySource === 'human-approved');
const provider = new GoogleNewsProvider();
const from = new Date(Date.now() - 90 * 86_400_000).toISOString();

const rows: Array<{
  name: string;
  fetched: number;
  kept: number;
  ambiguity: string;
  reasons: Record<string, number>;
}> = [];
for (const company of approved) {
  const plan = buildSearchQuery(company);
  try {
    const items = await provider.search({ query: plan.query, from, limit: 25 });
    const r = preFilterAll(items, company);
    rows.push({
      name: company.name,
      fetched: items.length,
      kept: r.kept.length,
      ambiguity: company.ambiguity,
      reasons: r.stats as unknown as Record<string, number>,
    });
  } catch {
    rows.push({
      name: company.name,
      fetched: -1,
      kept: -1,
      ambiguity: company.ambiguity,
      reasons: {},
    });
  }
}

const zeroFetch = rows.filter((r) => r.fetched === 0);
const zeroKept = rows.filter((r) => r.kept === 0);
console.log(`\napproved companies      ${rows.length}`);
console.log(`zero FETCHED (no candidates at all)  ${zeroFetch.length}`);
console.log(`zero KEPT   (nothing survived filter) ${zeroKept.length}`);
console.log(
  `total fetched ${rows.reduce((s, r) => s + Math.max(0, r.fetched), 0)}  total kept ${rows.reduce((s, r) => s + Math.max(0, r.kept), 0)}`,
);
console.log('\nzero-kept companies:');
for (const r of zeroKept)
  console.log(`  ${r.name.padEnd(24)} ${r.ambiguity.padEnd(9)} fetched ${r.fetched}`);
writeFileSync(
  new URL('../data/coverage-baseline.json', import.meta.url),
  JSON.stringify({ generatedFor: 'human-approved', windowDays: 90, rows }, null, 2) + '\n',
);

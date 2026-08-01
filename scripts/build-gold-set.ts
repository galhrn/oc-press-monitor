/**
 * Gold set construction (task P4.6, requirement R13).
 *
 *   npm run gold:build          # fetch a candidate pool and write an UNLABELLED gold set
 *
 * Produces `packages/classifier/eval/gold-set.json` with every `label` field null, ready for
 * human review. Nothing here assigns a label, and that is the point: section 8.4 Risk 1 says
 * the gold set must be labelled *before* anyone sees model output, or it is not ground truth.
 *
 * **Stratification is by observable features, never by the answer.** We cannot sample "12
 * negatives" without first deciding what is negative, which would make the eval circular. So
 * the strata are things the pipeline already knows - company ambiguity tier and pre-filter
 * verdict - chosen because they correlate with the cases that are hard:
 *
 *   kept-distinctive    mostly relevant; carries the sentiment spread
 *   kept-ambiguous      the decoys the pre-filter cannot catch (Shield -> a football club)
 *   softpass            qualifier-failing items, holding BOTH the noise (Astra -> OpenAI's
 *                       model) and the genuine coverage the old hard reject was losing
 *                       (Quantum Machines). There is no separate low-ambiguity soft-pass
 *                       stratum, and there cannot be: only human-approved queries are
 *                       conjunctive, and all 57 approved companies are critical or high.
 *   negative-signal     headlines carrying loss-language, so the rubric's rarest class is
 *                       represented at all. This is a sampling heuristic, not a label -
 *                       the reviewer still decides, and may well mark these positive.
 *
 * Selection is deterministic: candidates are ordered by a content hash, so re-running with
 * the same pool yields the same set.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@oc/core';
import {
  GoogleNewsProvider,
  buildSearchQuery,
  preFilter,
  type PreFilterCompany,
} from '@oc/collector';

type Registry = Array<PreFilterCompany & { querySource: string; ambiguity: string }>;

const registry = JSON.parse(
  readFileSync(new URL('../data/companies.json', import.meta.url), 'utf8'),
) as Registry;

/** Chosen for stratum coverage, not at random: decoy-rich names plus well-covered ones. */
const AMBIGUOUS = [
  'Astra',
  'Peak',
  'Shield',
  'Ro',
  'Island',
  'Near',
  'Greenlight',
  'Kini',
  'Harvey',
  'Launchpad',
  'Quantum Machines',
  'Spot AI',
  'Arrow Global',
  'Future Family',
  'Bites',
];
const DISTINCTIVE = [
  'Hailo',
  'Lemonade',
  'ZutaCore',
  'Cyabra',
  'Morphisec',
  'Innoviz',
  'Stripe',
  'SpaceX',
  'Cerebras',
  'Together AI',
  'OpenEvidence',
  'Maolac',
  'Wayup',
  'Rewire',
  'Hub Security',
];

/** Loss-language used only to *find* candidates for the rarest rubric class (section 6.2). */
const NEGATIVE_SIGNALS =
  /\b(layoff|lay off|lawsuit|sued|sues|probe|investigation|breach|recall|shut|shuts|shutdown|down round|resign|steps down|cuts|cut|decline|falls|drops|loss|losses|delay|delays|misses|warning|fraud|bankrupt)\b/i;

interface Candidate {
  id: string;
  company: string;
  companyId: string;
  ambiguity: string;
  querySource: string;
  title: string;
  url: string;
  sourceName: string | null;
  publishedAt: string | null;
  verdict: 'kept' | 'soft-pass';
  stratum: string;
}

const provider = new GoogleNewsProvider();
const from = new Date(Date.now() - 90 * 86_400_000).toISOString();
const pool: Candidate[] = [];

for (const name of [...AMBIGUOUS, ...DISTINCTIVE]) {
  const company = registry.find((c) => c.name === name);
  if (!company) {
    console.error(`  ! ${name} is not in the registry; skipping`);
    continue;
  }
  const plan = buildSearchQuery(company);
  const items = await provider.search({ query: plan.query, from, limit: 25 });
  for (const item of items) {
    const verdict = preFilter(item, company);
    if (!verdict.keep) continue;
    pool.push({
      id: sha256(`${company.id}:${item.url}`).slice(0, 16),
      company: company.name,
      companyId: company.id,
      ambiguity: company.ambiguity,
      querySource: company.querySource,
      title: item.title,
      url: item.url,
      sourceName: item.sourceName,
      publishedAt: item.publishedAt,
      verdict: verdict.softPass ? 'soft-pass' : 'kept',
      stratum: '',
    });
  }
  console.error(`  ${name.padEnd(20)} ${items.length} fetched`);
}

const isAmbiguous = (c: Candidate): boolean => c.ambiguity === 'critical' || c.ambiguity === 'high';

const assign = (c: Candidate): string => {
  if (NEGATIVE_SIGNALS.test(c.title)) return 'negative-signal';
  if (c.verdict === 'soft-pass') return 'softpass';
  return isAmbiguous(c) ? 'kept-ambiguous' : 'kept-distinctive';
};

for (const c of pool) c.stratum = assign(c);

const TARGETS: Record<string, number> = {
  'kept-distinctive': 18,
  'kept-ambiguous': 14,
  softpass: 20,
  'negative-signal': 8,
};

/** Deterministic order, and round-robin across companies so one loud name cannot dominate. */
const pick = (stratum: string, want: number): Candidate[] => {
  const byCompany = new Map<string, Candidate[]>();
  for (const c of pool.filter((x) => x.stratum === stratum)) {
    byCompany.set(c.company, [...(byCompany.get(c.company) ?? []), c]);
  }
  for (const list of byCompany.values()) list.sort((a, b) => a.id.localeCompare(b.id));

  const chosen: Candidate[] = [];
  const companies = [...byCompany.keys()].sort();
  let round = 0;
  while (chosen.length < want && companies.some((n) => (byCompany.get(n)?.length ?? 0) > round)) {
    for (const name of companies) {
      const item = byCompany.get(name)?.[round];
      if (item && chosen.length < want) chosen.push(item);
    }
    round += 1;
  }
  return chosen;
};

const selected = Object.entries(TARGETS).flatMap(([stratum, want]) => pick(stratum, want));

const goldSet = {
  version: 1,
  createdAt: new Date().toISOString(),
  windowDays: 90,
  provider: 'googlenews',
  /**
   * How the classifier sees an item at runtime. Recorded so the eval cannot accidentally
   * feed the model more context than production has (P3.3: there is no snippet).
   */
  inputShape: { fields: ['company', 'title'], note: 'headline only, ~10 words' },
  labelling: {
    status: 'UNLABELLED - awaiting human review',
    instructions:
      'For each item set relevant (is this article about THIS company?) and, when relevant, ' +
      'sentiment per section 6.2 (investor lens: positive | negative | neutral). Leave sentiment ' +
      'null when relevant is false. Do not consult model output before labelling.',
    labelledBy: null,
    labelledAt: null,
  },
  strata: Object.fromEntries(
    Object.keys(TARGETS).map((s) => [s, selected.filter((c) => c.stratum === s).length]),
  ),
  items: selected.map((c) => ({
    ...c,
    label: { relevant: null, sentiment: null, note: '' },
  })),
};

// Persist the full pool so the selection can be re-tuned without re-fetching.
const poolPath = fileURLToPath(new URL('../data/gold-candidates.json', import.meta.url));
writeFileSync(
  poolPath,
  `${JSON.stringify({ fetchedAt: goldSet.createdAt, pool }, null, 2)}
`,
  'utf8',
);

const out = fileURLToPath(new URL('../packages/classifier/eval/gold-set.json', import.meta.url));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(goldSet, null, 2)}\n`, 'utf8');

console.error(`\n  pool ${pool.length} candidates -> gold set ${selected.length} items`);
console.error(`  strata: ${JSON.stringify(goldSet.strata)}`);
console.error(`  companies represented: ${new Set(selected.map((c) => c.company)).size}`);
console.error(`  written -> ${out}\n`);

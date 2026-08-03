/**
 * Production spot-check sampler (task P8.2, requirement R13).
 *
 *   npm run spot-check          # draw the sample
 *   npm run spot-check -- --report   # score an already-filled sample
 *
 * Draws a stratified sample from the mentions the pipeline actually published and writes
 * `data/spot-check.json` with empty verdicts, ready for review.
 *
 * **Why stratify by ambiguity tier.** A uniform sample of 24 from 1,352 would be dominated by
 * distinctive names like ZutaCore, where the classifier is reliable, and would report a
 * flattering precision that says nothing about Shield, Peak or Ro. Errors concentrate on the
 * critical and high tiers, so the sample over-weights them and the report says so rather than
 * quietly generalising.
 *
 * **What this measures.** Precision, not recall: it can only find mentions we published that
 * should not have been. Articles the pipeline missed entirely are invisible here, and the
 * README says so - `data/coverage-baseline.json` is the closest thing we have to the other
 * half.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@oc/core';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

interface ExportedMention {
  companyId: string;
  company: string;
  title: string;
  url: string;
  source: string | null;
  publishedAt: string | null;
  sentiment: string | null;
  confidence: number | null;
  rationale: string | null;
}

interface Verdict {
  /** null until reviewed. */
  relevantActually: boolean | null;
  sentimentActually: string | null;
  note: string;
}

interface SpotCheckItem extends ExportedMention {
  id: string;
  ambiguity: string;
  verdict: Verdict;
}

const mentions = (
  JSON.parse(readFileSync(here('../data/mentions.json'), 'utf8')) as { mentions: ExportedMention[] }
).mentions;

const registry = JSON.parse(readFileSync(here('../data/companies.json'), 'utf8')) as Array<{
  id: string;
  ambiguity: string;
}>;
const tierOf = new Map(registry.map((c) => [c.id, c.ambiguity]));

const AMBIGUOUS = new Set(['critical', 'high']);
const TARGETS = { ambiguous: 14, distinctive: 10 } as const;

/** Deterministic order: same data in, same sample out, so the result is reproducible. */
const ordered = [...mentions].sort((a, b) =>
  sha256(`${a.companyId}:${a.url}`).localeCompare(sha256(`${b.companyId}:${b.url}`)),
);

const pick = (wantAmbiguous: boolean, limit: number): SpotCheckItem[] => {
  const seenCompanies = new Map<string, number>();
  const out: SpotCheckItem[] = [];
  for (const mention of ordered) {
    const ambiguity = tierOf.get(mention.companyId) ?? 'low';
    if (AMBIGUOUS.has(ambiguity) !== wantAmbiguous) continue;
    // At most two per company, so one loud name cannot define the score.
    const count = seenCompanies.get(mention.company) ?? 0;
    if (count >= 2) continue;
    seenCompanies.set(mention.company, count + 1);
    out.push({
      ...mention,
      id: sha256(`${mention.companyId}:${mention.url}`).slice(0, 12),
      ambiguity,
      verdict: { relevantActually: null, sentimentActually: null, note: '' },
    });
    if (out.length >= limit) break;
  }
  return out;
};

const out = here('../data/spot-check.json');

if (process.argv.includes('--report')) {
  const filled = JSON.parse(readFileSync(out, 'utf8')) as { items: SpotCheckItem[] };
  const reviewed = filled.items.filter((i) => i.verdict.relevantActually !== null);
  const truePositives = reviewed.filter((i) => i.verdict.relevantActually === true);
  const sentimentJudged = truePositives.filter((i) => i.verdict.sentimentActually !== null);
  const sentimentRight = sentimentJudged.filter((i) => i.verdict.sentimentActually === i.sentiment);

  const pct = (n: number, d: number): string =>
    d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(0)}%`;

  const byTier = (tier: 'ambiguous' | 'distinctive') => {
    const rows = reviewed.filter((i) => AMBIGUOUS.has(i.ambiguity) === (tier === 'ambiguous'));
    const ok = rows.filter((i) => i.verdict.relevantActually === true);
    return `${ok.length}/${rows.length} (${pct(ok.length, rows.length)})`;
  };

  console.error(`\n  reviewed                ${reviewed.length}`);
  console.error(
    `  relevance precision     ${truePositives.length}/${reviewed.length}  ${pct(truePositives.length, reviewed.length)}`,
  );
  console.error(`    critical/high tier    ${byTier('ambiguous')}`);
  console.error(`    medium/low tier       ${byTier('distinctive')}`);
  console.error(
    `  sentiment accuracy      ${sentimentRight.length}/${sentimentJudged.length}  ${pct(sentimentRight.length, sentimentJudged.length)}`,
  );
  console.error(`  (of correctly-identified mentions only)\n`);
} else {
  const items = [...pick(true, TARGETS.ambiguous), ...pick(false, TARGETS.distinctive)];
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        drawnFrom: mentions.length,
        method:
          'Deterministic hash order, stratified by ambiguity tier, max 2 per company. Measures precision only - articles the pipeline never found are invisible here.',
        targets: TARGETS,
        items,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.error(`\n  sampled ${items.length} of ${mentions.length} published mentions -> ${out}\n`);
  for (const item of items) {
    console.error(
      `  [${item.ambiguity.padEnd(8)}] ${item.company.padEnd(20)} ${(item.sentiment ?? '?').padEnd(9)} ${item.title.slice(0, 62)}`,
    );
  }
}

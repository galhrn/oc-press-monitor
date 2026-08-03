/**
 * Documentation consistency gate (part of `npm run verify`).
 *
 * project_context.md is only load-bearing if it is accurate. This enforces the two
 * failure modes that actually happen: a version header that drifts from the changelog,
 * and a decision still marked PROPOSED after the architecture was frozen.
 */
import { readFileSync } from 'node:fs';

const FILE = 'project_context.md';
const problems = [];

let text;
try {
  text = readFileSync(FILE, 'utf8');
} catch {
  console.error(`docs:check - cannot read ${FILE}`);
  process.exit(1);
}

const header = text.match(/\*\*Document version:\*\*\s*([0-9]+\.[0-9]+\.[0-9]+)/);
if (!header) problems.push('no "Document version:" header found');

const changelog = text.match(/\|\s*\d{4}-\d{2}-\d{2}\s*\|\s*([0-9]+\.[0-9]+\.[0-9]+)\s*\|/);
if (!changelog) problems.push('no dated changelog row found');

if (header && changelog && header[1] !== changelog[1]) {
  problems.push(
    `version drift: header says ${header[1]}, newest changelog row says ${changelog[1]}`,
  );
}

const proposed = [...text.matchAll(/\|\s*(AD-\d+)\s*\|[^|]*\|\s*\**PROPOSED\**\s*\|/g)].map(
  (m) => m[1],
);
if (proposed.length > 0) {
  problems.push(`decisions still PROPOSED after freeze: ${proposed.join(', ')}`);
}

const pending = (text.match(/_pending_/g) ?? []).length;
if (pending > 0) console.error(`docs:check - note: ${pending} open question(s) still pending`);

if (problems.length > 0) {
  console.error('docs:check FAILED');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.error(`docs:check OK - ${FILE} v${header[1]} consistent`);

/**
 * A deliberately small boolean-query matcher, used by the fixture provider so that an
 * offline run exercises the *same* query strings a live provider receives (P3.4).
 *
 * It understands exactly the shape the query builder emits and nothing more:
 *
 *   "Peak"                                        -> required: [Peak]
 *   "Peak" AND ("decision intelligence" OR "AI")  -> required: [Peak], groups: [[decision intelligence, AI]]
 *
 * An item matches when every required phrase is present AND at least one member of each
 * OR-group is present. Matching is whole-word and case-insensitive, which is the same rule
 * the deterministic pre-filter will use in P3.6 - a fixture that passes here is a fixture
 * that behaves consistently there.
 */

export interface ParsedQuery {
  required: string[];
  groups: string[][];
}

const quotedPhrases = (text: string): string[] =>
  [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]?.trim() ?? '').filter(Boolean);

/** Bare (unquoted) alternatives inside an OR-group, e.g. `(lidar OR sensor)`. */
const bareAlternatives = (text: string): string[] =>
  text
    .replace(/"[^"]*"/g, ' ')
    .split(/\bOR\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^AND$/i.test(s));

export function parseQuery(query: string): ParsedQuery {
  const groups: string[][] = [];
  for (const match of query.matchAll(/\(([^)]*)\)/g)) {
    const inner = match[1] ?? '';
    const terms = [...quotedPhrases(inner), ...bareAlternatives(inner)];
    if (terms.length > 0) groups.push(terms);
  }

  const outside = query.replace(/\([^)]*\)/g, ' ');
  const required = quotedPhrases(outside);
  if (required.length === 0) {
    // An unquoted query is treated as one phrase; the builder always quotes, so this is
    // only reachable when a human types a query by hand.
    const bare = outside.replace(/\bAND\b/gi, ' ').trim();
    if (bare) required.push(bare);
  }

  return { required, groups };
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-word, case-insensitive containment. `\b` is unreliable next to non-ASCII and
 * punctuation, so word boundaries are asserted explicitly against the neighbouring
 * character - this is what stops "Peak" matching "Peakhurst" or "speak".
 */
export function containsPhrase(haystack: string, phrase: string): boolean {
  const trimmed = phrase.trim();
  if (!trimmed) return false;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}])`, 'iu');
  return pattern.test(haystack);
}

export function matchesQuery(text: string, parsed: ParsedQuery): boolean {
  if (!parsed.required.every((phrase) => containsPhrase(text, phrase))) return false;
  return parsed.groups.every((group) => group.some((phrase) => containsPhrase(text, phrase)));
}

/**
 * A small boolean-query parser and evaluator (P3.1, rewritten in P3.4).
 *
 * It understands the query language the P2.4 triage actually produced:
 *
 *   "ZutaCore"
 *   "Peak" AND ("decision intelligence" OR "Peak.ai")
 *   "Together AI" OR "Together Computer" OR together.ai
 *   "Harvey AI" OR ("Harvey" AND ("legal AI" OR "law firm"))
 *
 * **Why this is a parser and not a regex.** The first version treated only parenthesised
 * groups as disjunctions and every other quoted phrase as required. Applied to the
 * committed registry that misread **16 of the approved queries**: `"Together AI" OR
 * "Together Computer"` became a demand for *both* phrases, which no headline satisfies, and
 * nested parentheses were matched by a pattern that cannot nest. Those queries are the
 * output of an hour of human review, and misreading them is the most expensive kind of bug
 * this project can have - it looks exactly like "no coverage".
 *
 * Matching is whole-word and case-insensitive, and **whitespace is significant**:
 * "launch pad" and "Launchpad" are different strings here, deliberately, because several
 * human-approved negative keywords discriminate on exactly that (section 4.3).
 *
 * A malformed query degrades to a broader search rather than throwing. A company whose
 * query has an unbalanced paren should return too much, never nothing at all.
 */

export type QueryNode =
  | { kind: 'phrase'; value: string }
  | { kind: 'and'; children: QueryNode[] }
  | { kind: 'or'; children: QueryNode[] };

type Token =
  | { type: 'phrase'; value: string }
  | { type: 'and' }
  | { type: 'or' }
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i] ?? '';

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === '"') {
      const end = input.indexOf('"', i + 1);
      const value = end === -1 ? input.slice(i + 1) : input.slice(i + 1, end);
      if (value.trim()) tokens.push({ type: 'phrase', value: value.trim() });
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    let j = i;
    while (j < input.length && !/[\s()"]/.test(input[j] ?? '')) j += 1;
    const word = input.slice(i, j);
    i = j;
    if (!word) continue;
    if (/^and$/i.test(word)) tokens.push({ type: 'and' });
    else if (/^or$/i.test(word)) tokens.push({ type: 'or' });
    else tokens.push({ type: 'phrase', value: word });
  }

  return tokens;
}

/** expr := term (OR term)* ; term := factor (AND factor)* ; factor := '(' expr ')' | phrase */
function parseTokens(tokens: readonly Token[]): QueryNode | null {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];

  const parseFactor = (): QueryNode | null => {
    const token = peek();
    if (token === undefined) return null;
    if (token.type === 'lparen') {
      pos += 1;
      const inner = parseExpr();
      if (peek()?.type === 'rparen') pos += 1; // tolerate a missing close paren
      return inner;
    }
    if (token.type === 'phrase') {
      pos += 1;
      return { kind: 'phrase', value: token.value };
    }
    pos += 1; // a stray operator: skip rather than fail the whole query
    return null;
  };

  const parseTerm = (): QueryNode | null => {
    const children: QueryNode[] = [];
    const first = parseFactor();
    if (first) children.push(first);
    // Adjacent phrases with no operator are treated as AND, which is how every search
    // engine this project talks to behaves.
    while (peek()?.type === 'and' || (children.length > 0 && isFactorStart(peek()))) {
      if (peek()?.type === 'and') pos += 1;
      const next = parseFactor();
      if (next) children.push(next);
    }
    if (children.length === 0) return null;
    return children.length === 1 ? (children[0] as QueryNode) : { kind: 'and', children };
  };

  const isFactorStart = (token: Token | undefined): boolean =>
    token !== undefined && (token.type === 'phrase' || token.type === 'lparen');

  const parseExpr = (): QueryNode | null => {
    const children: QueryNode[] = [];
    const first = parseTerm();
    if (first) children.push(first);
    while (peek()?.type === 'or') {
      pos += 1;
      const next = parseTerm();
      if (next) children.push(next);
    }
    if (children.length === 0) return null;
    return children.length === 1 ? (children[0] as QueryNode) : { kind: 'or', children };
  };

  return parseExpr();
}

export function parseBooleanQuery(query: string): QueryNode | null {
  return parseTokens(tokenize(query));
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

export function evaluateQuery(text: string, node: QueryNode | null): boolean {
  if (node === null) return true; // an empty query constrains nothing
  switch (node.kind) {
    case 'phrase':
      return containsPhrase(text, node.value);
    case 'and':
      return node.children.every((child) => evaluateQuery(text, child));
    case 'or':
      return node.children.some((child) => evaluateQuery(text, child));
  }
}

export function matchesQuery(text: string, query: string | QueryNode | null): boolean {
  return evaluateQuery(text, typeof query === 'string' ? parseBooleanQuery(query) : query);
}

/** True when a query says more than "this one phrase" - i.e. it actually disambiguates. */
export function hasDisambiguation(query: string): boolean {
  const node = parseBooleanQuery(query);
  return node !== null && node.kind !== 'phrase';
}

/**
 * True when a query constrains beyond a list of name variants - that is, it contains an
 * AND somewhere.
 *
 * This is the line between the two jobs a query does. `"Together AI" OR "Together Computer"`
 * is a *name check*: the pre-filter already does that, and better, because it also knows the
 * aliases. `"Peak" AND ("decision intelligence" OR "Peak.ai")` is *disambiguation*, which
 * nothing else in the pipeline can reconstruct. Only the second kind is enforced, so a
 * name-variant list can never veto an alias the registry legitimately holds.
 */
export function hasConjunction(query: string | QueryNode | null): boolean {
  const node = typeof query === 'string' ? parseBooleanQuery(query) : query;
  if (node === null) return false;
  if (node.kind === 'phrase') return false;
  if (node.kind === 'and') return true;
  return node.children.some((child) => hasConjunction(child));
}

/** Every phrase a query mentions, for logging and the run manifest. */
export function queryPhrases(node: QueryNode | null): string[] {
  if (node === null) return [];
  if (node.kind === 'phrase') return [node.value];
  return node.children.flatMap(queryPhrases);
}

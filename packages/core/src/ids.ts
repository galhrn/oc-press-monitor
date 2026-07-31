/** Deterministic identifiers. Same input always yields the same id, which is what
 *  makes the whole pipeline idempotent and safe to re-run (A5). */
import { createHash, randomUUID } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Canonicalises a URL for deduplication: lowercase host, no trailing slash,
 * no tracking parameters, no fragment. Two providers linking the same article
 * with different tracking tails must collapse to one row.
 */
const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
  'sh',
  'guccounter',
  'ncid',
]);

export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw.trim());
  url.protocol = url.protocol === 'http:' ? 'https:' : url.protocol;
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString();
}

export const articleId = (canonicalUrl: string): string => sha256(canonicalUrl);
export const mentionId = (companyId: string, artId: string): string =>
  sha256(`${companyId}:${artId}`);
export const companyId = (name: string): string => sha256(`company:${name.trim().toLowerCase()}`);

export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export const newRunId = (): string => randomUUID();

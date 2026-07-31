import { describe, expect, it } from 'vitest';
import { articleId, canonicalizeUrl, companyId, mentionId, slugify } from '@oc/core';

describe('canonicalizeUrl', () => {
  it('collapses tracking parameters so two providers dedupe to one article', () => {
    const a = canonicalizeUrl(
      'https://www.calcalist.co.il/article/123?utm_source=gdelt&utm_medium=rss',
    );
    const b = canonicalizeUrl('http://calcalist.co.il/article/123/#section');
    expect(a).toBe(b);
    expect(articleId(a)).toBe(articleId(b));
  });

  it('preserves meaningful query parameters', () => {
    expect(canonicalizeUrl('https://example.com/news?id=42&utm_campaign=x')).toContain('id=42');
  });

  it('orders query parameters deterministically', () => {
    expect(canonicalizeUrl('https://example.com/a?b=2&a=1')).toBe(
      canonicalizeUrl('https://example.com/a?a=1&b=2'),
    );
  });

  it('upgrades http to https', () => {
    expect(canonicalizeUrl('http://example.com/x')).toMatch(/^https:/);
  });
});

describe('deterministic ids', () => {
  it('produces stable ids for the same inputs', () => {
    expect(companyId('Hailo')).toBe(companyId(' hailo '));
    expect(mentionId('c1', 'a1')).toBe(mentionId('c1', 'a1'));
  });

  it('produces different ids for different pairs', () => {
    expect(mentionId('c1', 'a1')).not.toBe(mentionId('c2', 'a1'));
  });
});

describe('slugify', () => {
  it.each([
    ['Intuition Robotics', 'intuition-robotics'],
    ['Lambda (lambda.ai)', 'lambda-lambda-ai'],
    ['One Zero Digital Bank Ltd.', 'one-zero-digital-bank-ltd'],
    ['3d Signals', '3d-signals'],
  ])('%s -> %s', (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

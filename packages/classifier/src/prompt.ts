/**
 * Prompt loading, versioning and the user message (tasks P4.2, AD-16).
 *
 * The system prompt lives in `prompts/classify.v1.md` as a file, not a string literal, for
 * one reason: its **hash is stored on every classification row**. A label is only auditable
 * if you can prove which instructions produced it, and editing a markdown file is how a
 * prompt actually gets iterated on.
 *
 * The user message carries the disambiguation context from the P2 registry. That is the one
 * place enrichment earns its keep: "Shield AI: $1.5B Series G" is genuinely unanswerable from
 * a headline alone, and becomes answerable once the model knows this Shield does
 * communications compliance. Note the direction of travel - enrichment is *advisory input to
 * a judgement*, never a filter, which is the same line AD-26 and AD-29 draw.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@oc/core';

export const PROMPT_VERSION = 'classify.v1';

export const CLASSIFY_PROMPT_PATH = fileURLToPath(
  new URL('../../../prompts/classify.v1.md', import.meta.url),
);

let cached: { text: string; hash: string } | undefined;

/** Reads and caches the prompt file, with a short content hash for provenance. */
export function loadClassifyPrompt(path: string = CLASSIFY_PROMPT_PATH): {
  text: string;
  hash: string;
} {
  cached ??= (() => {
    const text = readFileSync(path, 'utf8');
    return { text, hash: sha256(text).slice(0, 12) };
  })();
  return cached;
}

/** Test seam - clears the memoised prompt. */
export const resetPromptCache = (): void => {
  cached = undefined;
};

/** `classify.v1@a1b2c3d4e5f6` - what is written to `mentions.prompt_version`. */
export const promptVersionTag = (path?: string): string =>
  `${PROMPT_VERSION}@${loadClassifyPrompt(path).hash}`;

export interface ClassifyContext {
  company: string;
  /** Sector from the registry, when the model claimed to know it (AD-26). */
  sector?: string | null;
  /** Things a naive search wrongly returns for this name. Capped to keep the prompt short. */
  negativeKeywords?: readonly string[];
  aliases?: readonly string[];
}

export interface ClassifyInput extends ClassifyContext {
  title: string;
}

const MAX_HINTS = 3;

/**
 * Builds the user message. Deliberately terse: the input is ~10 words, so a long preamble
 * would outweigh the thing being judged, and `num_ctx` is 1024 (AD-18).
 */
export function buildUserPrompt(input: ClassifyInput): string {
  const lines = [`Company: ${input.company}`];

  if (input.sector) lines.push(`Sector: ${input.sector}`);

  const aliases = (input.aliases ?? []).filter(Boolean).slice(0, MAX_HINTS);
  if (aliases.length > 0) lines.push(`Also written as: ${aliases.join(', ')}`);

  const negatives = (input.negativeKeywords ?? []).filter(Boolean).slice(0, MAX_HINTS);
  if (negatives.length > 0) {
    lines.push(`NOT this company: ${negatives.join(', ')}`);
  }

  lines.push('', `Headline: ${input.title.trim()}`);
  return lines.join('\n');
}

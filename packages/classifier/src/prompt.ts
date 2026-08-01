/**
 * Prompt loading, versioning and the user message (tasks P4.2, AD-16).
 *
 * The system prompt lives in `prompts/classify.vN.md` as a file, not a string literal, for one
 * reason: its **hash is stored on every classification row**. A label is only auditable if you
 * can prove which instructions produced it, and editing a markdown file is how a prompt
 * actually gets iterated on. The version is selectable so two prompts can be evaluated against
 * the same gold set - and because the cache key includes the version, an A/B cannot silently
 * serve answers produced by the other one.
 *
 * The user message carries the disambiguation context from the P2 registry. That is the one
 * place enrichment earns its keep: "Shield AI: $1.5B Series G" is unanswerable from a headline
 * until the model knows this Shield does communications compliance.
 *
 * **v2 changed the shape of that context, not just its wording.** In v1 the exclusions were a
 * `NOT this company:` line, and the 2026-08-02 bake-off showed `llama3.2:3b` ignoring it - it
 * accepted "Shield AI: $1.5 Billion Series G" while holding `Shield AI` as a negative keyword.
 * They are now a labelled `EXCLUDE` block the system prompt refers to by name as a hard rule.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sha256 } from '@oc/core';

/** The prompt shipped by default. v1 is kept so the bake-off can compare them. */
export const DEFAULT_PROMPT_VERSION = 'classify.v2';

export const promptPath = (version: string = DEFAULT_PROMPT_VERSION): string =>
  fileURLToPath(new URL(`../../../prompts/${version}.md`, import.meta.url));

const cache = new Map<string, { text: string; hash: string }>();

/** Reads and caches a prompt file, with a short content hash for provenance. */
export function loadClassifyPrompt(version: string = DEFAULT_PROMPT_VERSION): {
  text: string;
  hash: string;
} {
  const existing = cache.get(version);
  if (existing) return existing;
  const text = readFileSync(promptPath(version), 'utf8');
  const loaded = { text, hash: sha256(text).slice(0, 12) };
  cache.set(version, loaded);
  return loaded;
}

/** Test seam - clears the memoised prompts. */
export const resetPromptCache = (): void => cache.clear();

/** `classify.v2@a1b2c3d4e5f6` - what is written to `mentions.prompt_version`. */
export const promptVersionTag = (version: string = DEFAULT_PROMPT_VERSION): string =>
  `${version}@${loadClassifyPrompt(version).hash}`;

export interface ClassifyContext {
  company: string;
  /** Sector from the registry, when the model claimed to know it (AD-26). */
  sector?: string | null;
  /** Things a naive search wrongly returns for this name. */
  negativeKeywords?: readonly string[];
  aliases?: readonly string[];
}

export interface ClassifyInput extends ClassifyContext {
  title: string;
}

/** Enough to disambiguate without letting context outweigh a ten-word headline. */
const MAX_EXCLUSIONS = 5;
const MAX_ALIASES = 3;

/**
 * Builds the user message. Deliberately terse everywhere except the exclusions, which are the
 * one part a model was measurably skipping.
 */
export function buildUserPrompt(input: ClassifyInput): string {
  const lines = [`Company: ${input.company}`];

  if (input.sector) lines.push(`Sector: ${input.sector}`);

  const aliases = (input.aliases ?? []).filter(Boolean).slice(0, MAX_ALIASES);
  if (aliases.length > 0) lines.push(`Also written as: ${aliases.join(', ')}`);

  const exclusions = (input.negativeKeywords ?? [])
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, MAX_EXCLUSIONS);
  if (exclusions.length > 0) {
    lines.push('', 'EXCLUDE — if the headline is about any of these, answer relevant: false:');
    for (const exclusion of exclusions) lines.push(`  - ${exclusion}`);
  }

  lines.push('', `Headline: ${input.title.trim()}`);
  return lines.join('\n');
}

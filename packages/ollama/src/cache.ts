/**
 * Content-addressed response cache (AD-09).
 *
 * Key = model + prompt version + normalised input. A re-run therefore costs nothing,
 * which is what makes it affordable to iterate on the pipeline a dozen times against
 * thousands of items. Changing the prompt changes the key, so a stale prompt can never
 * silently serve stale answers.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '@oc/core';

export interface Cache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): void;
  readonly hits: number;
  readonly misses: number;
}

export function cacheKey(parts: { model: string; promptVersion: string; input: string }): string {
  return sha256(`${parts.model}|${parts.promptVersion}|${parts.input.trim()}`);
}

export function createFileCache(dir: string): Cache {
  mkdirSync(dir, { recursive: true });
  let hits = 0;
  let misses = 0;
  return {
    get<T>(key: string): T | undefined {
      const file = join(dir, `${key}.json`);
      if (!existsSync(file)) {
        misses += 1;
        return undefined;
      }
      try {
        const value = JSON.parse(readFileSync(file, 'utf8')) as T;
        hits += 1;
        return value;
      } catch {
        misses += 1;
        return undefined;
      }
    },
    set<T>(key: string, value: T): void {
      writeFileSync(join(dir, `${key}.json`), JSON.stringify(value), 'utf8');
    },
    get hits() {
      return hits;
    },
    get misses() {
      return misses;
    },
  };
}

/** For tests and for `--no-cache` runs. */
export function createNullCache(): Cache {
  return { get: () => undefined, set: () => undefined, hits: 0, misses: 0 };
}

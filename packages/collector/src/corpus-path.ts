import { fileURLToPath } from 'node:url';

/** The corpus shipped with the package, so `NEWS_PROVIDERS=fixture` needs no configuration. */
export const DEFAULT_CORPUS_PATH = fileURLToPath(
  new URL('../fixtures/corpus.json', import.meta.url),
);

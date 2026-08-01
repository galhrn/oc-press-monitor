import { fileURLToPath } from 'node:url';

/** The corpus shipped with the package, so `NEWS_PROVIDERS=fixture` needs no configuration. */
export const DEFAULT_CORPUS_PATH = fileURLToPath(
  new URL('../fixtures/corpus.json', import.meta.url),
);

/** A real Google News feed captured on 2026-08-02, used to test the RSS parser (P3.3). */
export const GOOGLE_NEWS_SAMPLE_PATH = fileURLToPath(
  new URL('../fixtures/google-news-sample.xml', import.meta.url),
);

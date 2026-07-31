-- Storage layer (AD-04). SQLite is the system of record; data/*.json are exports for review.
--
-- Two invariants do the heavy lifting:
--   articles.canonical_url is UNIQUE      -> cross-provider deduplication
--   mentions(company_id, article_id) UNIQUE -> idempotent upserts, so a re-run is a no-op

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL UNIQUE,
  slug              TEXT NOT NULL UNIQUE,
  aliases           TEXT NOT NULL DEFAULT '[]',
  domain            TEXT,
  sector            TEXT,
  ambiguity         TEXT NOT NULL DEFAULT 'low'
                      CHECK (ambiguity IN ('critical', 'high', 'medium', 'low')),
  volume            TEXT NOT NULL DEFAULT 'normal'
                      CHECK (volume IN ('high', 'normal')),
  query_override    TEXT,
  negative_keywords TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id            TEXT PRIMARY KEY,
  url           TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  source_name   TEXT,
  title         TEXT NOT NULL,
  snippet       TEXT,
  published_at  TEXT,
  provider      TEXT NOT NULL,
  language      TEXT,
  raw           TEXT,
  fetched_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_provider  ON articles (provider);

CREATE TABLE IF NOT EXISTS mentions (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies (id) ON DELETE CASCADE,
  article_id       TEXT NOT NULL REFERENCES articles (id) ON DELETE CASCADE,
  relevant         INTEGER,
  rejection_reason TEXT,
  sentiment        TEXT CHECK (sentiment IN ('positive', 'negative', 'neutral')),
  confidence       REAL CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
  rationale        TEXT,
  evidence         TEXT,
  model            TEXT,
  prompt_version   TEXT,
  classified_at    TEXT,
  first_seen_at    TEXT NOT NULL,
  UNIQUE (company_id, article_id)
);
CREATE INDEX IF NOT EXISTS idx_mentions_company   ON mentions (company_id);
CREATE INDEX IF NOT EXISTS idx_mentions_relevant  ON mentions (relevant);
CREATE INDEX IF NOT EXISTS idx_mentions_unclassified ON mentions (classified_at) WHERE classified_at IS NULL;

CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('backfill', 'daily', 'skeleton')),
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  stats       TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs (started_at DESC);

-- One row per alert actually emitted. The UNIQUE constraint is what makes the daily
-- job safe to re-run: the same mention can never be alerted twice on one channel.
CREATE TABLE IF NOT EXISTS alerts (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  mention_id TEXT NOT NULL REFERENCES mentions (id) ON DELETE CASCADE,
  channel    TEXT NOT NULL,
  sent_at    TEXT NOT NULL,
  payload    TEXT NOT NULL DEFAULT '{}',
  UNIQUE (mention_id, channel)
);

-- Watermarks and other small durable state (A5).
CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Aggregates for the dashboard. Bucketing itself is computed in TypeScript so the
-- boundary cases are unit-testable (task P5.3) rather than buried in SQL.
DROP VIEW IF EXISTS v_company_status;
CREATE VIEW v_company_status AS
SELECT
  c.id   AS company_id,
  c.name AS name,
  c.slug AS slug,
  MAX(CASE WHEN m.relevant = 1 THEN a.published_at END) AS last_mentioned_at,
  COUNT(CASE WHEN m.relevant = 1 AND a.published_at >= date('now', '-90 days') THEN 1 END) AS mentions_in_window,
  COUNT(CASE WHEN m.relevant = 1 AND m.sentiment = 'positive' AND a.published_at >= date('now', '-90 days') THEN 1 END) AS positive,
  COUNT(CASE WHEN m.relevant = 1 AND m.sentiment = 'negative' AND a.published_at >= date('now', '-90 days') THEN 1 END) AS negative,
  COUNT(CASE WHEN m.relevant = 1 AND m.sentiment = 'neutral'  AND a.published_at >= date('now', '-90 days') THEN 1 END) AS neutral
FROM companies c
LEFT JOIN mentions m ON m.company_id = c.id
LEFT JOIN articles a ON a.id = m.article_id
GROUP BY c.id, c.name, c.slug;

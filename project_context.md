# project_context.md — Living Source of Truth

> **Project:** OurCrowd Press Mentions Monitoring & Dashboard
> **Owner:** Gal Aharon
> **Status:** `BUILDING` — M0–M3 reached. Phase 3 complete; next is M4 (LLM classification + eval).
> **Last updated:** 2026-08-01
> **Document version:** 0.9.7
>
> **Target hardware (dev + demo machine):** Windows 11 · Intel Core Ultra (Lunar Lake) ·
> Intel Arc 140V iGPU, 16 GB addressable VRAM (shared) · 32 GB system RAM

---

## 0. How to use this file (read this first, every session)

This file is the **single source of truth** for the project. It is written primarily
for an AI coding assistant that starts each session with zero memory, and secondarily
for a human reviewer.

**Rules of engagement:**

1. At the start of every working session, the assistant reads this file **in full** before touching code.
2. Any change to structure, dependencies, data model, or a decision in §5 requires an **update to this file in the same commit**.
3. Sections marked `AUTHORITATIVE` override anything inferred from the codebase.
4. `OPEN QUESTION` items must never be resolved silently. They are escalated to the owner.
5. The changelog in §11 is append-only.

**Companion files:**

| File | Purpose |
|---|---|
| `project_context.md` | This file. Architecture, plan, decisions, structure. |
| `ai_prompts.md` | Verbatim log of prompts given to AI **coding assistants**. Required deliverable §5.6. |
| `prompts/*.md` | Versioned **runtime** prompts sent to the Ollama model at execution time. Not the same thing as `ai_prompts.md`. |
| `README.md` | Reviewer-facing. Setup, run commands, assumptions, limitations. Written last, from this file. |
| `docs/adr/*.md` | Architecture Decision Records — the long-form "why" behind §5. |

---

## 1. The assignment in one paragraph

Build a system that, for a seed list of **258 OurCrowd portfolio/fund companies**,
collects recent press coverage, classifies each mention's sentiment as
`positive | negative | neutral` using a **locally hosted Ollama model**, persists the
results with a link back to the source article, and presents them in a dashboard
showing (a) quarterly press appearances per company and (b) each company's current
"last mentioned" status. A **daily scheduled job** detects new mentions and fires an
alert. Backend and all data collection **must be Node.js**.

Graded on: correctness, code quality, use of the local LLM, documentation, product thinking.

---

## 2. Requirements traceability matrix `AUTHORITATIVE`

Every row below maps a literal requirement from the task PDF to where it is satisfied.
No row may be deleted. Status: `TODO` / `WIP` / `DONE` / `N/A`.

| # | Source | Requirement (verbatim intent) | Satisfied by | Status |
|---|---|---|---|---|
| R1 | §2.1 | Dashboard of press appearances per company over the last quarter | `apps/web` — Company grid + drill-down | **DONE** |
| R2 | §2.1 | Each mention classified positive / negative / neutral | `packages/classifier` | TODO |
| R3 | §2.1 | Each mention linked back to source URL | `articles.url` surfaced in the drill-down | **DONE** |
| R4 | §2.2 | Current "mention status" per company from last-mentioned date | `v_company_status` view + status chip in UI | WIP — logic + 20 boundary tests done, UI pending |
| R5 | §2.2 | Must handle "no coverage found" | Explicit `NO_COVERAGE` bucket, company still rendered | WIP — bucket implemented and tested, UI pending |
| R6 | §2.3 | Daily job checks for new mentions | `scripts/job-daily.ts` + `apps/scheduler` | TODO |
| R7 | §2.3 | Sends an alert when a new mention is found | `packages/alerting` | TODO |
| R8 | §3 | Company list is the source of truth | `data/companies.json` — 258 records, 57 human-approved queries | **DONE** |
| R9 | §3 | Document news-source choice **and its limitations** in README | README §"Data sources and their limitations" | **DONE** — every limitation measured, not assumed |
| R10 | §4.1 | Sentiment via **local Ollama only**, no cloud LLM | `packages/ollama` — the only LLM code path in the repo | WIP — client done, classifier prompt is P4.2 |
| R11 | §4.1 | README states which model and why | README §"LLM" | TODO |
| R12 | §4.1 | README states how the model is invoked (prompt structure, output format) | README + `prompts/` | TODO |
| R13 | §4.1 | README states how classification quality was validated | `packages/classifier/eval/` + README table | **WIP** — gold set + disclosure written; confusion matrix pending P4.7 |
| R14 | §4.2 | JavaScript/Node.js for backend **and data collection** | Entire repo (TypeScript → JS, AD-02) | **DONE** |
| R15 | §4.2 | Data-collection component | `packages/collector` | **DONE** — 2 live providers + fixtures, 141 tests |
| R16 | §4.2 | Classification step | `packages/classifier` | TODO |
| R17 | §4.2 | Storage layer | `packages/core/db` (SQLite) | **DONE** — schema, migrations, 6 repositories, 11 tests |
| R18 | §4.2 | Dashboard/UI layer | `apps/web` + `apps/api` | **DONE** |
| R19 | §4.2 | Scheduled job that performs the daily check and sends the alert | `apps/scheduler` | TODO |
| R20 | §5.4 | GitHub repo + README: what it does, structure | README | TODO |
| R21 | §5.4 | README: setup, deps, env vars, how to install/run Ollama + which model to pull | README §Setup | TODO |
| R22 | §5.4 | README: exact commands to run end-to-end locally | README §Quickstart | TODO |
| R23 | §5.4 | README: assumptions, trade-offs, known limitations | README §Assumptions | TODO |
| R24 | §5.5 | `data/` folder with output of a successful run: mentions, labels, links, last-mentioned status | `data/` committed artifacts | TODO |
| R25 | §5.6 | Copy of the full prompt used with AI coding assistants | `ai_prompts.md` | WIP |
| R26 | §6 | Reasonable error handling | Typed error hierarchy + fail-fast config; retry/backoff & circuit breaker pending P3 | WIP |
| R27 | §7 | Document assumptions where the spec is ambiguous | §4 of this file → README | WIP |

---

## 3. What the reviewers are actually testing `AUTHORITATIVE`

Derived from the task PDF + the Full Stack Developer JD. This drives prioritisation.

| Signal they want | Where it shows up in our build |
|---|---|
| Can he design a pipeline, not just a script? | Discrete, resumable stages with clean seams |
| Can he integrate an LLM *reliably* (not just call it)? | Structured output, schema validation, retries, caching, determinism, versioned prompts |
| Does he know an LLM's output needs **evaluation**? | Gold-set eval harness with a confusion matrix in the README |
| Does he think about **scale**? 258 companies is not 5. | Concurrency limits, rate limiting, dedup, incremental runs |
| Does he handle the **messy real world**? | Entity disambiguation (see §4.3) — the hidden hard problem |
| Product thinking | Sentiment axis defined for an *investor* lens; "no coverage" treated as a first-class state |
| Can a stranger run it? | Offline fixture mode + one-command quickstart |
| Senior maturity | ADRs, traceability matrix, documented trade-offs, honest limitations |

**JD-specific hooks worth landing** (the JD names these explicitly):
Node.js microservices · LLM & agentic tooling in production · SQL **and** NoSQL familiarity ·
low-code orchestration (**n8n / Make**) · end-to-end ownership incl. testing & monitoring ·
clean, well-tested code.

---

## 4. Assumptions & ambiguities `AUTHORITATIVE`

Each of these goes into the README verbatim.

| # | Ambiguity | Decision | Rationale |
|---|---|---|---|
| A1 | "Last quarter" = calendar Q2 2026, or trailing 90 days? | **Trailing 90 days**, rolling, configurable via `QUARTER_WINDOW_DAYS=90` | A rolling window is the more useful monitoring product; calendar quarters go stale. Both supported by config. |
| A2 | The task says the list contains "name + any identifying detail such as domain or sector"; the delivered file contains **names only** | We enrich into `data/companies.json` with alias/sector/domain/negative-keyword fields | Documented gap; enrichment is a committed, reviewable artifact |
| A3 | Ambiguous company names (Shield, Peak, Wave, Near, Orchard, Silo, Guild, Astra, Casper, Overtime, Launchpad, Bites, Kini…) | Multi-layer relevance filtering, §4.3 | Naive search would produce mostly false positives — the single biggest correctness risk |
| A4 | Very-high-volume names (Stripe, SpaceX, xAI, Anthropic, Databricks) | Cap mentions per company per run (`MAX_ITEMS_PER_COMPANY`) | Prevents a handful of companies consuming the entire LLM budget |
| A5 | "New mention" definition for the daily alert | An article whose `(company_id, article_id)` pair has not been persisted before **and** whose `published_at` is within `ALERT_LOOKBACK_HOURS` | Makes the job idempotent and re-runnable |
| A6 | Full article text vs headline+snippet for classification | Headline + snippet by default; `--enrich` flag opt-in for body extraction | Paywalls/robots make body fetching unreliable and slow; documented as a limitation |
| A7 | Sentiment of what, exactly? | Sentiment **toward the company, from an investor/reputation perspective** — not the article's general tone | §6.2 rubric |
| A8 | Do all 258 companies need a full run? | Yes for the committed `data/` artifact; `--limit` flag for dev loops | Deliverable R24 asks for a real run |
| A9 | Ollama has **no official Intel Arc acceleration**; Vulkan is opt-in/experimental and IPEX-LLM is a separate distribution | Benchmark three backends (CPU · Vulkan · IPEX-LLM) in Phase 1, pick by measurement, document the result | An honest, measured infrastructure note is worth more than an unverified "runs on GPU" claim. See AD-19. |
| A10 | Reviewers will run this on unknown hardware | Model choice must be viable **CPU-only**; README states measured timings for both CPU and GPU paths | A reviewer whose run takes 3 hours will not finish it |

### 4.3 The hidden hard problem: entity disambiguation

The seed list contains many single common-word names. A naive query for `Shield` or
`Peak` returns almost entirely irrelevant news. Our layered defence, cheapest first:

1. **Registry enrichment** — aliases, domain, sector, `disambiguationHints[]`, `negativeKeywords[]` per company.
2. **Query construction** — exact-phrase quoting, plus a sector qualifier for names flagged `ambiguity: high`.
3. **Deterministic pre-filter** — whole-word match of name/alias in title or snippet; drop blocked domains; drop obvious noise.
   > **P3.6 constraint, discovered in the P2.3 full run:** negative-keyword matching must be
   > **whitespace-sensitive**. Several human-approved negatives discriminate purely by spacing —
   > `Launchpad` excludes `"launch pad"`, `Greenlight` excludes `"green light"`, `Wayup` excludes
   > `"way up"`. A pre-filter that normalises whitespace before matching would read those as the
   > company's own name and reject 100% of its genuine coverage. Match on the literal phrase.
4. **LLM relevance gate** — the classification call returns `relevant: boolean` *in the same response* as the sentiment, so relevance costs zero extra inference.
5. **Auditability** — rejected mentions are persisted with a rejection reason so precision can be measured, not asserted.

---

## 5. Architectural decisions `AUTHORITATIVE`

Status: `PROPOSED` / `ACCEPTED` / `SUPERSEDED`. Long-form rationale lives in `docs/adr/`.

| ID | Decision | Status | One-line rationale |
|---|---|---|---|
| AD-01 | Node.js 20 LTS+, ESM modules | ACCEPTED | Mandated by task §4.2 |
| AD-02 | TypeScript (strict) across the repo | **ACCEPTED** | Senior signal + on the CV; compiles to JS so §4.2 holds. README states this explicitly. (OQ-3 resolved.) |
| AD-03 | npm **workspaces** monorepo — modular monolith with service-ready seams | **ACCEPTED** | Demonstrates microservice thinking without operational over-build; ADR documents the split path |
| AD-04 | Storage: **SQLite** (driver per AD-23) as system of record, **plus** JSON/CSV exports into `data/` | **ACCEPTED** | Need unique constraints, indexed date-range queries and watermarks; JSON exports satisfy R24 for reviewers |
| AD-05 | News sourcing: **GDELT DOC 2.0** primary (keyless, exact rolling 3-month window) + **Google News RSS** for the daily delta, behind a `NewsProvider` interface with a `FixtureProvider` | **ACCEPTED** | Zero API keys = reviewer can actually run it; interface keeps NewsAPI/Brave as drop-ins |
| AD-06 | Classification: single Ollama call returning `{relevant, sentiment, confidence, rationale, evidence}` | **ACCEPTED** | Halves inference cost vs separate relevance + sentiment passes |
| AD-07 | Model cascade (small bulk model + larger arbiter for low-confidence items) | **CONDITIONAL — default OFF** | Superseded in spirit by AD-17. Build **only** if the bake-off shows the small model missing the accuracy bar. Shipping an unnecessary cascade is over-engineering. |
| AD-08 | Deterministic inference: `temperature: 0`, fixed `seed`, Ollama structured-output JSON schema | **ACCEPTED** | Reproducible runs; parseable output without regex scraping |
| AD-09 | Content-hash classification cache keyed by `model + promptVersion + normalizedText` | **ACCEPTED** | Re-runs are near-free; makes iteration on the pipeline affordable |
| AD-10 | Frontend: **React 18 + Vite + TypeScript**, static SPA served by the API in production | **ACCEPTED** | No SSR/SEO need → Next.js is unjustified weight; vanilla means hand-rolling table state for 258 rows |
| AD-11 | API: **Express 5** + `zod` request/response validation | **ACCEPTED** | CV-aligned and reviewer-familiar; Fastify considered (ADR-0011) |
| AD-12 | Scheduling: daily check is an **idempotent CLI**; `node-cron` is a thin wrapper; OS-cron / GitHub Actions / n8n documented as production paths | **ACCEPTED** | Decouples "what runs" from "what triggers it" — the actual senior point |
| AD-13 | Alerting: `Alerter` interface; console + JSON-file always on, Slack webhook optional | **ACCEPTED** | Reviewer sees it work with zero configuration |
| AD-14 | Testing: **Vitest** — unit, integration against mocked providers + fake Ollama, plus an LLM eval suite | **ACCEPTED** | Testing is called out in both the task and the JD |
| AD-15 | Logging: `pino` structured JSON with `runId` / `companyId` correlation + per-run manifest | **ACCEPTED** | "monitoring" is a named JD responsibility |
| AD-16 | Prompt versioning: runtime prompts are files under `prompts/`; the prompt hash is stored on every classification row | **ACCEPTED** | Makes every label traceable to the exact prompt that produced it |
| AD-17 | **Right-sizing by measurement.** Model selection is decided by a bake-off against the gold set, ascending from the smallest candidate. Ship the **smallest model within 2 points of macro-F1 of the best.** | **ACCEPTED** | The task is 3-class classification of ~150-token text — the easiest class of LLM work. Asserting "a 7B is better" is an opinion; a bake-off table is evidence. See §6.4. |
| AD-18 | **Inference-parameter right-sizing:** `num_ctx: 1024` (not the 4096–8192 default), `num_predict: 96`, terse rationale (≤15 words), `keep_alive: 30m`, tuned `OLLAMA_NUM_PARALLEL` | **ACCEPTED** | Right-sizing is not only about parameter count. Context window drives KV-cache memory and bandwidth; output tokens dominate latency. These levers are free and most candidates never touch them. |
| AD-19 | **Ollama runtime backend on Intel Arc:** benchmark CPU vs `OLLAMA_VULKAN=1` vs Intel IPEX-LLM portable build; select by measurement, document in README | **ACCEPTED** | Upstream Ollama has no official Intel Arc/SYCL path; Vulkan is opt-in experimental and is reported to be *slower than CPU* on some iGPUs. Must be verified, not assumed. |
| AD-25 | Throughput is **measured with `npm run bench`**, using Ollama's own `eval_count` / `eval_duration` rather than wall clock, with a discarded warm-up per configuration | **ACCEPTED** | Wall-clock timing conflates model-load cost, queueing and decoding. Separating them is what distinguishes "the GPU is idle" from "the model is large" — two problems with opposite fixes. Feeds the AD-17 bake-off table directly. |
| AD-23 | Storage driver is **`node:sqlite`** (built into Node), not `better-sqlite3` | **ACCEPTED** | `better-sqlite3` is a native addon: `npm install` failed on the owner's Windows machine with a node-gyp error for want of Visual Studio C++ Build Tools. A take-home whose install can fail on the reviewer's machine is a take-home that does not get run. Zero compilers, zero third-party dependency. Costs `db.transaction()`, replaced by a nest-safe SAVEPOINT helper. |
| AD-24 | The Ollama client (`packages/ollama`) is **pulled forward from P4.1 into P2** | **ACCEPTED** | Registry enrichment needs it too (AD-21). Building it once, shared, is better than a throwaway; it also de-risks the critical path by proving the LLM integration two days early. |
| AD-21 | Company registry is **both** an Ollama-generated artifact and committed reviewed config: ship `scripts/enrich-companies.ts` (runs on Ollama) *and* commit its hand-reviewed output to `data/companies.json` | **ACCEPTED** | §4.1 mandates Ollama for "any other text understanding step". Enrichment arguably qualifies. Doing both satisfies the strict reading, keeps the repo cloud-free, and preserves human review of the 57 flagged names. |
| AD-22 | **Query triage covers all 258 companies, not a sampled subset**, on two independent axes: *ambiguity* (query rewriting) and *news volume* (budget capping) | **ACCEPTED** | Conflating "generates noise" with "generates too much" would apply the wrong fix to 19 companies. SpaceX isn't ambiguous — it's just loud. |
| AD-26 | **Model output is sanitised before it may influence the registry.** `sanitizeEnrichment` drops the entire enrichment when the model returns `known: false`, drops aliases and domains that do not resemble the company name, drops negative keywords contained in the company's own name, and treats the literal string `"null"` as absent. A discarded enrichment demotes the row to `triage-default` rather than being recorded as a source that contributed nothing. | **ACCEPTED** | The measured P2.3 pass produced systematic, not random, errors: Stripe → alias `"PayPal"`, OncoHost → negative keyword `"oncohost"` (which would have rejected 100% of its genuine coverage in the P3.6 pre-filter), OpenEvidence → `opeven.com`. A2/A3 say enrichment is advisory; this makes that mechanical rather than aspirational. |
| AD-27 | **`fast-xml-parser` added as the only new production dependency** for Google News RSS, rather than hand-rolling a reader | **ACCEPTED** | Pure JS, no native build, so AD-23's "install must never fail on a reviewer's machine" still holds. The deciding factor was entity handling: the feed emits numeric references like `&#39;` constantly, and a regex reader that silently leaves them in corrupts every affected headline before it ever reaches the classifier. |
| AD-28 | **Google News redirect-URL resolution is not attempted.** The Google link is stored as the article URL; the publisher domain from `<source url>` is recorded separately for dedupe | **ACCEPTED** | Measured 2026-08-02: the `guid` is an opaque `AU_yqL…` token, not the old protobuf carrying the URL, and following the link returns HTTP 200 with a ~580 KB JavaScript interstitial rather than a redirect. Recovering the publisher URL would need JS execution or reverse-engineering an internal API — brittle, and against the feed's stated terms. P3.5 therefore needs a (title, domain, date) dedupe key alongside the URL hash. **Refined by P3.5:** the date is compared within a **7-day tolerance**, not for equality — GDELT's `seendate` lags a publisher's `pubDate`, so exact-date matching would fail on precisely the cross-provider case the second key exists for. |
| AD-29 | **Qualifier groups are enforced only for human-approved queries.** The pre-filter re-applies our own boolean query client-side, but treats the OR-group qualifiers as a hard filter only when a human vetted them | **ACCEPTED** | Measured on live Google News data 2026-08-02: enforcing the model's invented qualifiers (`"Endpoint Security" OR "Threat Detection" OR "AI-Powered"`) left **Morphisec with 0 kept articles out of 10**; gating the rule on provenance recovered a genuine one. Since P3.3 established neither provider returns a snippet, every qualifier is being tested against a bare headline — far less text than whoever wrote it assumed. Enforcing model-invented terms under those conditions also contradicts AD-26. |
| AD-30 | **The sent query and the pre-filter apply the same qualifier policy**, via one shared predicate (`shouldEnforceQualifiers`). Only *conjunctive* queries are enforced; a top-level OR of name variants is left to the name/alias check | **ACCEPTED** | Measured A/B on live Google News 2026-08-02. Asymmetry loses in both directions: sending qualifiers the filter will not enforce starved the fetch (Kando 5 kept → 0, Morphisec 3 → 1), and enforcing qualifiers the query never requested dropped everything that came back (Peak 6 → 0, Shield 2 → 0). Restricting enforcement to conjunctions keeps a name-variant list from vetoing a legitimate alias. |
| AD-31 | **A qualifier miss soft-passes to the LLM relevance gate instead of being dropped.** The company name already matched; only the disambiguation term is absent | **ACCEPTED** | Measured across the 57 approved companies: 293 items failed only on a qualifier, and the bucket is not uniformly noise — `Astra` correctly loses 18 articles about OpenAI's model while `Quantum Machines` lost a genuine one to a headline that said "Real-Time Control Strategy" instead of "quantum control". The qualifiers assume headline **+ snippet**; P3.3 established there is no snippet. Adopting it moved zero-coverage companies **26 → 14** and kept articles **282 → 572**. §6.4 is explicit that the pre-filter cuts cost, not correctness. |
| AD-32 | **Ship `llama3.2:3b` + `classify.v1`, and state plainly that the 0.80 macro-F1 exit criterion was not met (best measured 0.522).** `qwen2.5:3b`+v2 scored higher (0.577) but projects to ~7 hours for a production run | **ACCEPTED** | Two measured facts drove this. (1) Prompt iteration moved the operating point, not the discrimination: v2 fixed 13 items and broke 11 on `qwen2.5:3b`, and the split was perfectly clean — every fix a genuine article, every break a decoy. A threshold slide cannot buy both sides, so a v3 would re-tune the same knob. (2) Accuracy and feasibility point in opposite directions; at 233 min `llama3.2:3b`+v1 is the only configuration that both scores respectably and finishes inside the remaining schedule. The task states a documented partial solution is preferred over an undocumented complete one, so the bake-off table and the miss go in the README as evidence. |
| AD-20 | Fine-tuned encoder classifiers (FinBERT/DistilBERT) **considered and rejected** — documented in an ADR, not silently omitted | **ACCEPTED** | The theoretically right tool for this task is a ~110M-param encoder, ~100× smaller than any LLM here. The task mandates Ollama. Saying so explicitly is the strongest possible right-sizing signal. |

---

## 6. System design

### 6.1 Pipeline

```
                    ┌─────────────────────────────────────────┐
 companies.json ──▶ │ 1. COLLECT   NewsProvider(s)            │
                    │    GDELT · Google News RSS · Fixtures   │
                    └───────────────┬─────────────────────────┘
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │ 2. NORMALIZE & DEDUPE                   │
                    │    canonical URL, article_id = sha256   │
                    └───────────────┬─────────────────────────┘
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │ 3. PRE-FILTER (deterministic, free)     │
                    │    whole-word match · blocklist · dates │
                    └───────────────┬─────────────────────────┘
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │ 4. CLASSIFY (Ollama, cached, p-limit)   │
                    │    relevance + sentiment in one call    │
                    └───────────────┬─────────────────────────┘
                                    ▼
                    ┌─────────────────────────────────────────┐
                    │ 5. PERSIST (SQLite, upsert, idempotent) │
                    └───────────────┬─────────────────────────┘
                                    ▼
              ┌─────────────────────┴───────────────────┐
              ▼                     ▼                   ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │ 6a. AGGREGATE    │  │ 6b. EXPORT       │  │ 6c. ALERT        │
    │  company status  │  │  data/*.json     │  │  new mentions    │
    └────────┬─────────┘  └──────────────────┘  └──────────────────┘
             ▼
     ┌──────────────┐      ┌──────────────┐
     │  Express API │ ◀──▶ │  React SPA   │
     └──────────────┘      └──────────────┘
```

Every stage is independently invokable and resumable. A failure in one company never
aborts the run; it is recorded in the run manifest.

### 6.2 Sentiment rubric (investor lens) `AUTHORITATIVE`

| Label | Signals |
|---|---|
| `positive` | Funding round, favourable acquisition/exit, product launch, major partnership, regulatory approval, award, strong growth/results, notable customer win |
| `negative` | Layoffs, lawsuit/investigation, data breach, recall, down round, shutdown, executive departure under pressure, missed targets, negative analyst coverage |
| `neutral` | Routine appointments, factual/directory listings, passing mention in a market roundup, balanced reporting with no clear valence toward the company |

Edge cases the prompt must handle explicitly: industry-negative but company-neutral
articles; the company benefiting from a competitor's bad news; the company named only
as an investor in someone else.

### 6.3 Data model (SQLite)

| Table | Key columns | Notes |
|---|---|---|
| `companies` | `id`, `name`, `slug`, `aliases`, `domain`, `sector`, `ambiguity`, `negative_keywords` | Seeded from the enriched registry |
| `articles` | `id` = sha256(canonical_url), `url`, `title`, `snippet`, `source_name`, `published_at`, `provider`, `fetched_at` | One row per unique article |
| `mentions` | `id` = sha256(company_id + article_id), FK both, `relevant`, `rejection_reason`, `sentiment`, `confidence`, `rationale`, `evidence`, `model`, `prompt_version`, `classified_at` | `UNIQUE(company_id, article_id)` → idempotent upsert |
| `runs` | `id`, `type`, `started_at`, `finished_at`, `status`, `stats_json` | Run manifest |
| `alerts` | `id`, `run_id`, `mention_id`, `channel`, `sent_at`, `payload_json` | Prevents duplicate alerts |
| `kv` | `key`, `value` | Watermarks |
| `v_company_status` (view) | `last_mentioned_at`, `days_since`, `status_bucket`, sentiment counts in window | Powers R4/R5 |

**Status buckets:** `FRESH` ≤7d · `RECENT` ≤30d · `STALE` ≤90d · `DORMANT` >90d · `NO_COVERAGE`.

### 6.4 Model selection protocol (right-sizing) `AUTHORITATIVE`

**Principle:** the model is a dependency like any other, and the correct size is the
smallest one that meets the quality bar. We establish the bar first, then climb the
ladder from the bottom and stop at the first rung that clears it.

**Task profile — why small is defensible here:**

| Property | Value | Implication |
|---|---|---|
| Input | Headline + ~200-char snippet | ~120–180 tokens. No long-context reasoning. |
| Output | Fixed JSON, 5 fields | ~60–90 tokens, schema-constrained |
| Task type | 3-class classification + binary relevance | No multi-hop reasoning, no generation, no tool use |
| Volume | ~2,000–4,000 calls per full run | Throughput matters more than peak capability |

**The ladder — run in this order, stop when the bar is met:**

| Rung | Model | q4 size | Role |
|---|---|---|---|
| 1 | `qwen2.5:1.5b-instruct` | ~1.0 GB | Floor probe — "is the task genuinely this easy?" |
| 2 | `llama3.2:3b-instruct` | ~2.0 GB | Expected landing spot |
| 3 | `qwen2.5:3b-instruct` | ~1.9 GB | Same class, typically stronger at structured extraction |
| — | `qwen2.5:7b-instruct` | ~4.7 GB | **Reference ceiling only.** Measures the gap; not shipped unless rungs 1–3 all fail. |

**Ship rule:** the smallest model within **2 points of macro-F1** of the best result.
If rung 1 lands within 2 points of the 7B, we ship a 1 GB model and say so loudly.

**Deliverable:** the bake-off table (model · macro-F1 · per-class precision/recall ·
p50 latency · full-run wall clock · resident memory · JSON-validity rate) goes into the
README. The table *is* the argument. Nothing else in this project demonstrates
"matched the tool to the problem" as directly.

**Right-sizing levers other than parameter count** (apply to whichever model wins):

1. **Don't call the model at all** — the deterministic pre-filter (§4.3 layer 3) is
   expected to eliminate 40–60% of candidates for zero inference cost. The cheapest
   token is the one never generated.
2. **Content-hash cache** (AD-09) — development re-runs cost nothing.
3. **`num_ctx: 1024`** instead of the default — cuts KV-cache footprint and bandwidth
   several-fold on inputs that never exceed ~400 tokens.
4. **Cap and shorten the output** — `num_predict: 96`, rationale capped at 15 words.
   Output tokens dominate latency in a bandwidth-bound setup.
5. **Quantization as a size axis** — compare `q8_0` on a 1.5B against `q4_K_M` on a 3B
   at comparable memory; higher-precision-small can beat lower-precision-large.
6. **Tune `OLLAMA_NUM_PARALLEL`** empirically — on a bandwidth-bound iGPU the optimum
   is typically 2–4, and more is often slower.

---

## 7. Target repository structure & file purpose

> Status: **planned**. Update this tree whenever a file is added, moved, or deleted.

```
oc-press-monitor/
├── README.md                        # Reviewer-facing docs (R20–R23). Written last.
├── project_context.md               # THIS FILE — living source of truth
├── ai_prompts.md                    # Verbatim AI coding-assistant prompt log (R25)
├── .env.example                     # Every env var, documented, with safe defaults
├── package.json                     # Workspace root; all top-level npm scripts
│
├── docs/
│   ├── adr/                         # Architecture Decision Records (long-form "why")
│   └── architecture.md              # Rendered diagrams + component contracts
│
├── prompts/
│   ├── classify.v1.md               # Runtime Ollama prompt — versioned, hash-tracked
│   └── enrich-company.v1.md         # One-off registry enrichment prompt
│
├── data/                            # COMMITTED output of a successful run (R24)
│   ├── companies.json               # Enriched seed registry
│   ├── mentions.json                # All mentions + sentiment + source URLs
│   ├── company_status.json          # Computed "last mentioned" status per company
│   ├── coverage-baseline.json       # Measured candidate/keep counts per approved company (R9)
│   ├── quarterly_summary.json       # Aggregates powering the dashboard
│   ├── alerts.log.json              # Alert history from the daily job
│   └── press.sqlite                 # The database itself
│
├── packages/
│   ├── core/                        # Shared kernel — no dependencies on siblings
│   │   ├── config.ts                # Env parsing + validation (zod), fail-fast
│   │   ├── logger.ts                # pino, run-scoped child loggers
│   │   ├── errors.ts                # Typed error hierarchy
│   │   ├── db/schema.sql            # DDL, migrations, views
│   │   └── db/index.ts              # better-sqlite3 connection + repositories
│   │
│   ├── collector/                   # DATA COLLECTION (R15)
│   │   ├── src/provider.ts          # NewsProvider interface + RawArticle/SearchRequest
│   │   ├── src/query-match.ts       # Boolean query parser + evaluator; whole-word, spacing-preserving
│   │   ├── src/query-builder.ts     # What to actually send per company (P3.4, AD-30)
│   │   ├── src/throttle.ts          # Shared per-provider request spacing (P3.2/P3.3)
│   │   ├── src/collect.ts           # Orchestration: caps, failure isolation, breaker (P3.7)
│   │   ├── src/circuit-breaker.ts   # Per-provider breaker (P3.7, R26)
│   │   ├── src/pre-filter.ts        # Deterministic pre-filter with auditable rejections (P3.6)
│   │   ├── src/normalize.ts         # Canonical URL, article_id, two-key cross-provider dedupe (P3.5)
│   │   ├── src/corpus-path.ts       # Path to the shipped corpus, so fixture mode needs no config
│   │   ├── src/providers/gdelt.ts   # Primary: keyless, rolling 3-month window (P3.2)
│   │   ├── src/providers/google-news.ts # Daily delta via RSS (P3.3)
│   │   ├── src/providers/fixture.ts # Offline/test provider (P3.1)
│   │   ├── fixtures/corpus.json     # Hand-authored offline corpus; provenance in `_provenance`
│   │   ├── fixtures/google-news-sample.xml # REAL feed captured 2026-08-02, parser test input
│   │   ├── query-builder.ts         # Per-company query strategy (§4.3)
│   │   └── normalize.ts             # Canonical URL, dedupe, date parsing
│   │
│   ├── classifier/                  # LLM LAYER (R10, R16)
│   │   └── eval/gold-set.json       # 60 stratified items, human-labelled (R13)
│   │   ├── ollama-client.ts         # HTTP client, retries, timeouts, keep-alive
│   │   ├── prompt.ts                # Prompt builder + version hashing
│   │   ├── schema.ts                # zod schema == Ollama structured-output schema
│   │   ├── cache.ts                 # Content-hash cache (AD-09)
│   │   ├── classify.ts              # Orchestration, concurrency, cascade (AD-07)
│   │   └── eval/                    # Gold set + confusion matrix + macro-F1 (R13)
│   │
│   ├── pipeline/                    # Stage orchestration, run manifests, exports
│   └── alerting/                    # Alerter interface + console/file/slack impls (R7)
│
├── apps/
│   ├── api/                         # Express 5 read API for the dashboard
│   ├── web/                         # React + Vite dashboard (R1, R4, R18)
│   └── scheduler/                   # node-cron wrapper around the daily CLI (R19)
│
├── test/                            # Root suite for the CLI entry points under scripts/
│   └── enrich-args.test.ts          # Guards the "--limit must not clobber the registry" rule
│
├── scripts/
│   ├── args.ts                      # Enrich CLI argument parsing (pure, unit-tested)
│   ├── seed-companies.ts            # ourcrowd_companies.txt → enriched registry
│   ├── run-backfill.ts              # Full 90-day historical run
│   ├── job-daily.ts                 # The daily check + alert (idempotent CLI)
│   └── export-data.ts               # Regenerate everything under data/
│
└── .github/workflows/
    ├── ci.yml                       # lint · typecheck · test · eval
    └── daily.yml                    # Documented production scheduling path
```

---

## 8. Work plan `AUTHORITATIVE`

### 8.0 Conventions

| Element | Rule |
|---|---|
| **Task ID** | `P<phase>.<n>` — stable and referenceable. Every commit message cites one (`feat(collector): GDELT provider [P3.2]`). |
| **Satisfies** | The requirement ID from §2 that a task discharges. A task with no `R#` is infrastructure and must justify itself. |
| **Est.** | Focused working hours. Not elapsed time. |
| **Milestone** | `M<n>` — a **demonstrable artifact**, not a feeling. If it can't be run, shown or opened, it isn't a milestone. |
| **Exit criteria** | Objective gate. A phase is not closed until every criterion is literally true. |
| **Status** | `TODO` / `WIP` / `DONE` / `CUT` |

**Global Definition of Done** — applies to *every* task, not just the phase gates:

1. Code is typechecked and lint-clean.
2. Non-trivial logic has a unit test; a stage boundary has an integration test.
3. Failure paths are handled explicitly — no bare `catch {}`, no unhandled rejection.
4. Anything a reviewer must know is in the README, not only in a commit message.
5. `project_context.md` §7 (structure), §5 (decisions) and §11 (changelog) reflect the change **in the same commit**.
6. A new prompt used to produce the work is appended to `ai_prompts.md`.

---

### 8.1 Roadmap & milestones

| Phase | Name | Milestone — demonstrable artifact | Est. | Depends on |
|---|---|---|---|---|
| **P0** | Planning & Decision Freeze | **M0** — Architecture frozen; `project_context.md` + `ai_prompts.md` committed | 3 h | — |
| **P1** | Foundation & Scaffolding | **M1** — `npm run verify` green; walking skeleton writes one stub row end-to-end | 5 h | M0 |
| **P2** | Company Registry | **M2** — `data/companies.json`, 258 companies enriched, ambiguous names hand-reviewed | 4 h | M1 |
| **P3** | Data Collection | **M3** — `npm run collect -- --company Hailo` returns deduped, normalised articles; full suite runs offline | 7 h | M2 |
| **P4** | LLM Classification & Evaluation | **M4** — Bake-off table produced; model selected by measurement; macro-F1 recorded | 9 h | M1 (fixtures unblock start) |
| **P5** | Pipeline, Status & Alerts | **M5** — One command runs the full pipeline and writes every `data/*.json` artifact | 6 h | M3, M4 |
| **P6** | API & Dashboard | **M6** — Dashboard renders all three required outputs from real data | 8 h | M5 |
| **P7** | Scheduling & Alert Delivery | **M7** — Daily job fires on schedule, detects a genuinely new mention, emits an alert | 3 h | M5 |
| **P8** | Production Run & Delivery | **M8** — Submission-ready; fresh-clone rehearsal passed | 6 h | M6, M7 |
| | | **Total** | **~51 h** | |

### 8.2 Critical path & parallelisation

```
P0 ─▶ P1 ─┬─▶ P2 ─▶ P3 ─┬─▶ P5 ─┬─▶ P6 ─┬─▶ P8
          │              │       │       │
          └─▶ P4 ────────┘       └─▶ P7 ─┘
```

- **Critical path:** P0 → P1 → P2 → P3 → P5 → P6 → P8 (~39 h).
- **P4 runs in parallel with P2/P3** — the classifier is developed against fixtures, so
  it never waits on live collection. This is the main schedule win, and it's the reason
  the `FixtureProvider` is built in P1 rather than as an afterthought.
- **P7 runs in parallel with P6** — different surfaces, shared pipeline.
- **P1.8 (walking skeleton) is deliberately early.** A hardcoded single company pushed
  through stubbed stages into SQLite proves the seams fit before any stage is real.
  Integration risk discovered in P1 is cheap; discovered in P5 it is not.

### 8.3 Pre-declared descope ladder

Task §7: *"a partially complete solution with clear notes on what's missing is preferred
over an undocumented 'complete' one."* Deciding the cut order **now**, while calm,
prevents cutting the wrong thing at 2am. Cut strictly top-down:

| Order | Cut | Cost of cutting | Status |
|---|---|---|---|
| 1 | n8n workflow artifact (P7.4) | Loses a JD bonus signal only | **CUT** — stretch goal only |
| 2 | Model cascade (already CONDITIONAL, AD-07) | None — it's evidence-gated anyway | **CUT** |
| 3 | Slack alerting (P7.3) — keep console + file | Alerting still demonstrably works | **CUT** (OQ-4) |
| 4 | Quarterly trend chart (P6.5) — keep sentiment distribution | Dashboard still satisfies R1 | Held in reserve |
| 5 | Gold set 60 → 30 items | Wider confidence interval; eval still exists | Held in reserve |
| 6 | Company sample < 258, documented in README | Weakens the "real run" artifact | Held in reserve |

**Never cut** — these *are* the evaluation criteria: the eval harness existing at all ·
the README · the `data/` artifacts · `ai_prompts.md` · the relevance pre-filter ·
error handling · the "no coverage" state.

---

### 8.4 Phases in detail

#### Phase 0 — Planning & Decision Freeze `WIP`

> **Objective:** Agree the architecture before a line of code exists.
> **Milestone M0:** Decisions frozen; both living documents committed.

| ID | Task | Satisfies | Est. | Status |
|---|---|---|---|---|
| P0.1 | Read and analyse task, JD, CV, company list | — | 0.5 h | DONE |
| P0.2 | Reverse-engineer evaluation criteria and hidden requirements | — | 0.5 h | DONE |
| P0.3 | Draft architecture, tech stack, pipeline design | — | 1 h | DONE |
| P0.4 | Create `project_context.md` + `ai_prompts.md` | R25, R27 | 0.5 h | DONE |
| P0.5 | Right-size the model; define the selection protocol (§6.4) | R10, R11 | 0.5 h | DONE |
| P0.6 | **Resolve OQ-1, OQ-3, OQ-4, OQ-5, OQ-7 with the owner** | — | — | **TODO** |
| P0.7 | Promote AD-01…AD-20 from `PROPOSED` to `ACCEPTED` | — | — | TODO |

> **Exit criteria:** no `PROPOSED` decision remains · no blocking open question remains ·
> both markdown files committed.
> **Risk:** analysis paralysis. P0 is capped at 3 h; unresolved non-blocking questions
> move to a phase, they do not hold the gate.

---

#### Phase 1 — Foundation & Scaffolding `TODO`

> **Objective:** A repo where every subsequent task is cheap to add and impossible to break silently.
> **Milestone M1:** `npm run verify` passes; the walking skeleton writes one stub row end-to-end.

| ID | Task | Satisfies | Est. | Status |
|---|---|---|---|---|
| P1.1 | Init repo, npm workspaces, `.gitignore`, MIT licence, conventional-commit config | R14 | 0.5 h | **DONE** |
| P1.2 | Toolchain: tsconfig (strict), ESLint, Prettier, Vitest, `npm run verify` aggregate script | R26 | 1 h | **DONE** |
| P1.3 | `core/config.ts` — zod-validated env parsing, fail-fast on boot, `.env.example` | R21 | 0.5 h | **DONE** |
| P1.4 | `core/logger.ts` — pino, run-scoped child loggers with `runId`/`companyId` | R26 | 0.5 h | **DONE** |
| P1.5 | `core/errors.ts` — typed error hierarchy (`ProviderError`, `ClassificationError`, `ConfigError`) | R26 | 0.5 h | **DONE** |
| P1.6 | SQLite schema, migration runner, `v_company_status` view (§6.3) | R17 | 1 h | **DONE** |
| P1.7 | Repository layer + repository unit tests | R17 | 0.5 h | **DONE** |
| P1.8 | **Walking skeleton** — one hardcoded company through stubbed collect→classify→persist | — | 0.5 h | **DONE** |
| P1.9 | GitHub Actions CI: lint · typecheck · test | R26 | 0.5 h | **DONE** |

> **Exit criteria:** CI green on a clean clone · `npm run verify` passes locally ·
> the skeleton writes a row and the DB opens · README skeleton exists with the section headings from §2.
> **Risk:** `better-sqlite3` is a native module and needs build tools on Windows. Verify
> in P1.6; the documented fallback is `node:sqlite` (Node 22+).

---

#### Phase 2 — Company Registry `TODO`

> **Objective:** Turn 258 bare names into a queryable, disambiguation-aware registry.
> **Milestone M2:** `data/companies.json` committed, all 258 present, high-ambiguity names hand-reviewed.

| ID | Task | Satisfies | Est. | Status |
|---|---|---|---|---|
| P2.1 | Parser for `ourcrowd_companies.txt` → normalised records, slug generation | R8 | 0.5 h | **DONE** |
| P2.2 | `prompts/enrich-company.v1.md` — aliases, sector, domain, ambiguity, negative keywords | R8, R10 | 0.5 h | **DONE** |
| P2.3 | `scripts/enrich-companies.ts` — **runs against local Ollama** (AD-21), batch, resumable, cached; regenerates the registry for any seed list | R8, R10 | 1 h | **DONE** — full 258-company pass on `llama3.2:3b`, 2026-08-01, 0 failures |
| P2.4 | **Hand-review the 57 flagged names** — 25 CRITICAL + 32 HIGH (full triage complete; see `company_query_review.md` / `OurCrowd_Company_Query_Triage.xlsx`) | R8, A3 | 1 h | **DONE** — approved 2026-07-31 |
| P2.7 | Apply the approved queries as `queryOverride` on flagged records; unflagged records use the Ollama-generated query | R8 | 0.5 h | **DONE** |
| P2.5 | Registry loader + zod schema + unit tests (count == 258, no dup slugs, required fields) | R8 | 0.5 h | **DONE** |
| P2.6 | Commit `data/companies.json`; document the A2 gap in the README | R9, R23 | 0.5 h | **DONE** |

> **Exit criteria:** 258 records · zero duplicate slugs · every `ambiguity: high` record
> has ≥1 disambiguation hint and ≥1 negative keyword · loader tests green.
> **Risk:** LLM-invented facts (wrong sector/domain). Mitigation: enrichment is advisory,
> never authoritative; the hand-review in P2.4 is not optional.

---

#### Phase 3 — Data Collection `DONE`

> **Objective:** Fetch and clean news for any company, from any provider, testable offline.
> **Milestone M3:** `npm run collect -- --company Hailo` returns deduped normalised articles; the whole test suite runs with no network.

| ID | Task | Satisfies | Est. | Status |
|---|---|---|---|---|
| P3.1 | `NewsProvider` interface + `FixtureProvider` + fixture corpus | R15 | 1 h | **DONE** — 23 tests. Corpus is **hand-authored, not recorded**; P3.2 adds `--record` for a real GDELT capture. |
| P3.2 | GDELT DOC 2.0 provider — 90-day window, rate limiting, retry + backoff | R15 | 1.5 h | **CODE DONE** — 25 offline tests. **Live verification blocked:** GDELT returns HTTP 429 to this machine even at 1 request / 75 s. See the 0.8.4 changelog row and the new risk below. |
| P3.3 | Google News RSS provider — XML parsing; **redirect resolution dropped, see below** | R15 | 1 h | **DONE — live-verified end-to-end.** 20 tests, including against a real captured feed. |
| P3.4 | Query builder — exact-phrase, qualifiers, provenance-tiered strategies; **boolean query parser rewritten** | A3 | 1 h | **DONE** — 14 tests; measured A/B against live Google News |
| P3.5 | Normalisation — canonical URL, `article_id` hash, date parsing, cross-provider dedupe | R15 | 1 h | **DONE** — 20 tests; two-key dedupe (URL hash + content key with date tolerance) |
| P3.6 | Deterministic pre-filter — whole-word match, negative keywords, domain blocklist, client-side query re-application | A3 | 1 h | **DONE** — 21 tests; measured on live data via `npm run measure:prefilter` |
| P3.7 | Per-company caps, partial-failure isolation, provider circuit breaker, `npm run collect` | R26, A4 | 0.5 h | **DONE** — 13 tests; demonstrated live with GDELT down |
| P3.8 | Provider + normalisation + pre-filter unit tests; offline integration test | R26 | — | **DONE** — `pipeline.integration.test.ts` stubs `globalThis.fetch` to reject, so a reintroduced live call fails the suite |

> **Exit criteria:** both live providers return results for 5 sampled companies ·
> a manual precision check on 3 ambiguous names shows the pre-filter working ·
> one provider failing does not abort a run · full suite passes with the network disabled.
> **Risk — MATERIALISED 2026-08-02:** GDELT rate-limits. It is currently returning HTTP 429
> to this machine even for a single request after a 75 s pause, so the primary provider is
> unverified against live traffic. The mitigation designed for exactly this — two independent
> providers plus fixtures — is now load-bearing rather than theoretical: P3.3 moves ahead of
> P3.4, and if GDELT stays blocked the README documents it as a measured limitation (R9)
> rather than the repo shipping a primary provider nobody has seen work.

---

#### Phase 4 — LLM Classification & Evaluation `TODO`

> **Objective:** Turn an article into a trustworthy, reproducible label — and prove it's trustworthy.
> **Milestone M4:** Bake-off table produced; model selected by measurement per AD-17; macro-F1 recorded.
> **Runs in parallel with P2–P3** using fixtures.

| ID | Task | Satisfies | Est. | Status |
|---|---|---|---|---|
| P4.0 | **Backend benchmark (AD-19)** — CPU vs Vulkan vs IPEX-LLM on the Arc 140V; record tok/s | R11, A9 | 0.5 h | **TOOL DONE** (`npm run bench`) — awaiting the owner's measurement |
| P4.1 | `ollama-client.ts` — structured output, timeout, retry, `keep_alive`, health check | R10 | 1 h | **DONE** — pulled forward into `packages/ollama` (AD-24), 15 tests |
| P4.2 | `prompts/classify.v1.md` — rubric §6.2, few-shot examples, edge cases, version hash | R12, R16 | 1.5 h | TODO |
| P4.3 | zod schema ↔ Ollama JSON schema; parse-and-repair fallback path | R16, R26 | 0.5 h | TODO |
| P4.4 | Content-hash cache (AD-09) | — | 0.5 h | **DONE** — shipped with AD-24 |
| P4.5 | Concurrency control, right-sized inference params (AD-18), progress reporting | — | 0.5 h | **DONE** — shipped with AD-24 |
| P4.6 | **Label a 60-item gold set** — stratified, includes ambiguous-name negatives | R13 | 1.5 h | **DONE** — 60 items labelled (AI-drafted, owner-reviewed 2026-08-02); 39 relevant / 21 decoys; 20 pos / 7 neg / 12 neutral |
| P4.7 | Eval harness — confusion matrix, macro-F1, per-class P/R, JSON-validity rate | R13 | 1.5 h | TODO |
| P4.8 | **Run the §6.4 bake-off** across the ladder; produce the README table; select the model | R11, R13 | 1.5 h | **RUN — BAR NOT MET.** Best combined macro-F1 **0.522** against a 0.80 exit criterion. See 0.9.4. |
| P4.9 | Decide AD-07: activate the cascade only if the winner misses the bar | — | — | **DECIDED: stays CUT.** The winner does miss the bar, but a cascade routes low-confidence items to a *larger* model and the largest we can run is already too slow (~7 h). The cascade would make the run infeasible without fixing the discrimination problem the per-item diff exposed. |

> **Exit criteria:** selected model ≥ **0.80 macro-F1** on the gold set · ≥99% JSON
> validity across the full gold run · bake-off table written into the README · every
> stored label carries its `model` + `prompt_version`.
> **Risk 1:** the gold set is the project's ground truth — label it *before* seeing model
> output, or it is worthless.
> **Risk 2:** no backend clears usable throughput. Mitigation: descope to rung 1 of the
> ladder and document the constraint honestly.

---

#### Phase 5 — Pipeline, Status & Alerts `TODO`

> **Objective:** Compose the stages into one resumable, idempotent, observable run.
> **Milestone M5:** A single command executes the full pipeline and writes every `data/*.json` artifact.

| ID | Task | Satisfies | Est. | Status |
|---|---|---|---|---|
| P5.1 | Stage orchestration, `runs` manifest, resumability, partial-failure tolerance | R26 | 1.5 h | TODO |
| P5.2 | Status computation — buckets, `days_since`, **`NO_COVERAGE` as a first-class state** | R4, R5 | 1 h | TODO |
| P5.3 | Boundary unit tests for bucketing (0d / 7d / 8d / 30d / 90d / 91d / never) | R4 | 0.5 h | TODO |
| P5.4 | Exporters → `mentions.json`, `company_status.json`, `quarterly_summary.json` | R24 | 1 h | TODO |
| P5.5 | `Alerter` interface + console + JSON-file sinks | R7 | 0.5 h | TODO |
| P5.6 | `scripts/job-daily.ts` — watermark, overlap lock, idempotent re-run | R6, A5 | 1 h | TODO |
| P5.7 | Integration test: run daily twice → second run emits zero alerts | R6, R26 | 0.5 h | TODO |

> **Exit criteria:** full pipeline runs on fixtures with zero manual steps · running it
> twice produces identical DB state and no duplicate alerts · every one of the 258
> companies appears in `company_status.json`, including zero-coverage ones · a killed run
> resumes without data loss.
> **Risk:** idempotency bugs are silent and corrupt the alert story. P5.7 is the guard and is mandatory.

---

#### Phase 6 — API & Dashboard `TODO`

> **Objective:** Make the three required outputs legible at a glance.
> **Milestone M6:** Dashboard renders quarterly mentions, sentiment labels with source links, and per-company status — from real data.

| ID | Task | Satisfies | Est. | Status |
|---|---|---|---|---|
| P6.1 | Express 5 app, zod-validated routes, error middleware, `/health` | R18 | 1 h | **DONE** |
| P6.2 | Endpoints: companies+status · company mentions · quarterly stats · latest run | R1, R4 | 1 h | **DONE** |
| P6.3 | React + Vite shell, API client, loading/error/empty states | R18 | 1 h | **DONE** |
| P6.4 | Company grid — status chips, sentiment counts, search + filters | R1, R4 | 1.5 h | **DONE** — `useDeferredValue`; TanStack Table not needed for 258 rows |
| P6.5 | Charts — sentiment distribution (Recharts donut) | R1 | 1 h | **DONE** — trend chart still held in reserve (descope rung 4) |
| P6.6 | Company drill-down — mention list with **clickable source URLs** | R3 | 1 h | **DONE** — slide-over, `rel="noopener noreferrer"`, per-item rationale |
| P6.7 | `NO_COVERAGE` treated as a visible state, not an empty row | R5 | 0.5 h | **DONE** — dashed-outline chip, company keeps its row |
| P6.8 | Serve the SPA build from Express so `npm start` is one command | R22 | 0.5 h | **DONE** — `npm run serve`, SPA fallback verified |
| P6.9 | Screenshots for the README | R20 | 0.5 h | TODO |

> **Exit criteria:** every one of the 258 companies is reachable in the UI · every mention
> links to a working source URL · a zero-coverage company renders a clear state · a
> reviewer can find "which companies had negative press this quarter" in under 10 seconds.
> **Risk:** UI scope creep. R1/R3/R4/R5 are the whole brief — polish only after all four are covered.

---

#### Phase 7 — Scheduling & Alert Delivery `TODO`

> **Objective:** Make the daily check real and visible.
> **Milestone M7:** The scheduled job fires, detects a genuinely new mention, and emits an alert.

| ID | Task | Satisfies | Est. | Status |
|---|---|---|---|---|
| P7.1 | `node-cron` wrapper — explicit `Asia/Jerusalem` TZ, overlap lock, boot catch-up | R19 | 1 h | TODO |
| P7.2 | Alert payload design — company, headline, sentiment, source URL, timestamp | R7 | 0.5 h | TODO |
| P7.3 | Slack webhook sink (optional, env-gated, degrades to console when unset) | R7 | 0.5 h | TODO |
| P7.4 | `.github/workflows/daily.yml` + n8n workflow JSON as documented alternatives | R19 | 0.5 h | TODO |
| P7.5 | Demo run + captured alert output committed to `data/alerts.log.json` | R7, R24 | 0.5 h | TODO |

> **Exit criteria:** the job runs unattended on schedule · a re-run within the same window
> alerts nothing · alert output is committed so a reviewer sees it without running anything ·
> README documents all four scheduling paths.
> **Risk:** a reviewer won't wait 24h to see it work. Mitigation: `--force` and `--dry-run`
> flags plus committed sample output.

---

#### Phase 8 — Production Run & Delivery `TODO`

> **Objective:** Ship something a stranger can run and a reviewer can grade.
> **Milestone M8:** Submission-ready; fresh-clone rehearsal passed.

| ID | Task | Satisfies | Est. | Status |
|---|---|---|---|---|
| P8.1 | **Full production run across all 258 companies**; capture timings, failure counts, cost | R24 | 1.5 h | TODO |
| P8.2 | Spot-check ~20 classified mentions by hand; record findings honestly | R13 | 0.5 h | TODO |
| P8.3 | Commit every `data/` artifact | R24 | 0.5 h | TODO |
| P8.4 | Write the README from §2 — every `R#` row becomes a section | R20–R23 | 2 h | TODO |
| P8.5 | Finalise `ai_prompts.md`; write the ADRs in `docs/adr/` | R25 | 0.5 h | TODO |
| P8.6 | **Fresh-clone rehearsal** — a different directory, follow the README literally, fix every gap | R22 | 1 h | TODO |
| P8.7 | Demo GIF/screenshots; final repo hygiene pass; push | R20 | 0.5 h | TODO |

> **Exit criteria:** every row in §2 reads `DONE` or `CUT` with a documented reason ·
> the fresh-clone rehearsal succeeded from the README **alone** · `data/` is populated
> from a real run · no `TODO`/`FIXME`/commented-out code · no secrets committed.
> **Risk:** the README is written last and rushed. Mitigation: it is drafted incrementally
> from P1 onward; P8.4 is an edit pass, not a first draft.

---

### 8.6 Calendar — deadline Tue 4 Aug 2026, 16:00 `AUTHORITATIVE`

**Target submission: Monday 3 Aug, evening.** Tuesday morning is buffer, not plan.
Budget ≈30 focused hours; descope rungs 1–3 already cut (§8.3).

| Slot | Phases | Milestone | Hrs |
|---|---|---|---|
| **Fri 31 Jul, late** | P0.6, P0.7 — approve triage, freeze decisions | **M0** | 1 |
| **Sat 1 Aug** | P1 (foundation) → P2 (registry) → P4.0–P4.5 (Ollama client, prompt, cache) | **M1, M2** | 10 |
| **Sun 2 Aug** | P3 (collection) → P4.6–P4.9 (gold set, eval, bake-off) | **M3, M4** | 9 |
| **Mon 3 Aug** | P5 (pipeline, status, alerts) → P6 (API + dashboard) | **M5, M6** | 8 |
| **Mon 3 Aug, evening** | P7 (scheduler) → P8.1–P8.5 (production run, README) | **M7** | 4 |
| **Tue 4 Aug, morning** | P8.6 fresh-clone rehearsal → P8.7 push → **submit by 12:00** | **M8** | 2 |

**Hard checkpoints — if a checkpoint slips, cut immediately rather than absorbing it:**

| When | Must be true | If not |
|---|---|---|
| Sat 1 Aug, end of day | M2 done; Ollama answering with valid JSON | Cut rung 5 (gold set → 30) |
| Sun 2 Aug, end of day | **M4 done — model selected, bake-off table exists** | Cut rung 4 (trend chart) |
| Mon 3 Aug, midday | M5 done — pipeline writes `data/*.json` | Cut rung 6 (sample < 258, documented) |
| Mon 3 Aug, 22:00 | M7 done | Submit as-is with a "known gaps" README section |

> **Rule:** the production run (P8.1) starts **no later than Mon 18:00**. It is the one
> task whose duration is not fully under our control, and `data/` is a graded deliverable.
> Start it early and let it run while the README is written.

---

### 8.5 Progress dashboard

| Milestone | Phase | Status |
|---|---|---|
| M0 Architecture frozen | P0 | ✅ DONE |
| M1 Foundation green | P1 | ✅ DONE — 46 tests |
| M2 Registry enriched | P2 | ✅ DONE — 258 companies, full live Ollama pass, 0 failures |
| M3 Collection working | P3 | ✅ **DONE** — `npm run collect -- --company ZutaCore` returns 12 deduped live articles with GDELT failing; `--providers fixture` runs fully offline |
| M4 Model selected by evidence | P4 | 🟡 **selected by evidence, bar not met** — `llama3.2:3b`+v1 at 0.522 combined vs a 0.80 criterion; documented rather than hidden |
| M5 Pipeline end-to-end | P5 | ⚪ TODO |
| M6 Dashboard complete | P6 | 🟡 built and verified against live data; screenshots (P6.9) pending |
| M7 Daily job live | P7 | ⚪ TODO |
| M8 Submission ready | P8 | ⚪ TODO |

---

## 9. Environment variables (planned)

| Var | Default | Purpose |
|---|---|---|
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | Local Ollama endpoint |
| `OLLAMA_MODEL` | `llama3.2:3b` _(provisional — confirmed by the §6.4 bake-off)_ | Classification model |
| `OLLAMA_ARBITER_MODEL` | _unset_ | Optional cascade model — only if AD-07 is activated |
| `OLLAMA_CONCURRENCY` | `3` | Client-side parallel inference requests (tune per AD-18) |
| `OLLAMA_NUM_CTX` | `1024` | Context window — right-sized to our input length (AD-18) |
| `OLLAMA_NUM_PREDICT` | `96` | Output token cap (AD-18) |
| `OLLAMA_KEEP_ALIVE` | `30m` | Prevents model reload between calls |
| `OLLAMA_TIMEOUT_MS` | `60000` | Per-request timeout |
| `QUARTER_WINDOW_DAYS` | `90` | Definition of "last quarter" (A1) |
| `MAX_ITEMS_PER_COMPANY` | `25` | Budget cap per run (A4) |
| `NEWS_PROVIDERS` | `gdelt,googlenews` | Ordered provider list; `fixture` for offline |
| `ALERT_CHANNELS` | `console,file` | Comma-separated alert sinks |
| `SLACK_WEBHOOK_URL` | _unset_ | Optional Slack alerting |
| `CRON_SCHEDULE` | `0 8 * * *` | Daily job schedule |
| `CRON_TIMEZONE` | `Asia/Jerusalem` | Explicit timezone |
| `DB_PATH` | `./data/press.sqlite` | SQLite file |
| `LOG_LEVEL` | `info` | pino level |

---

## 10. Open questions `DO NOT RESOLVE SILENTLY`

| ID | Question | Blocking | Owner answer |
|---|---|---|---|
| OQ-1 | Submission deadline / realistic time budget? | Phase scope | **ANSWERED:** Hard deadline **Tue 4 Aug 2026, 16:00**. Target submission **Mon 3 Aug evening** to land ahead of other candidates. Budget ≈30 h → descope rungs 1–3 pre-cut. See §8.6. |
| OQ-2 | Ollama host machine — Apple Silicon / NVIDIA GPU / CPU-only, and RAM? | AD-07, model choice | **ANSWERED 2026-07-31:** Windows 11, Intel Arc 140V iGPU (16 GB shared VRAM), 32 GB RAM. RAM is not the constraint; **memory bandwidth is**. Drives AD-17/18/19. |
| OQ-8 | Which Ollama backend wins on the Arc 140V — CPU, Vulkan, or IPEX-LLM? | AD-19, all timings | **PARTIALLY ANSWERED 2026-08-01 — ship CPU.** Measured: CPU only. `ollama ps` confirms 100% CPU (upstream Ollama has no Intel Arc path). CPU throughput is sufficient (see the 0.8.2 changelog row), so the Vulkan and IPEX-LLM paths were **deliberately not measured** — a schedule decision, not a result. The README must say exactly that rather than implying a three-way bake-off happened. Rationale: the Arc 140V shares LPDDR5X with the CPU, so there is no dedicated-bandwidth win to unlock, and the measured tok/s is flat across concurrency — the signature of a bandwidth ceiling. |
| OQ-9 | If rung 1 (`qwen2.5:1.5b`) clears the accuracy bar, ship a 1 GB model? | AD-17 | _pending bake-off — but the ship rule says yes_ |
| OQ-3 | TypeScript (AD-02) or plain JS + JSDoc, given the literal "JavaScript (Node.js)" wording? | Phase 1 | **ANSWERED: TypeScript.** AD-02 → ACCEPTED. README states the compiles-to-JS rationale explicitly. |
| OQ-4 | Alert channels to actually implement? | AD-13 | **ANSWERED: console + JSON file only.** Slack cut (descope rung 3). `Alerter` interface still ships so a sink is a 20-line addition. |
| OQ-5 | Enrich all 258 companies with the LLM, or hand-curate only the high-ambiguity subset? | Phase 2 effort | **ANSWERED: automated enrichment across all 258 + hand-review of every flagged name.** Owner requires the *entire* list triaged, not a ~40 estimate. Delivered as `OurCrowd_Company_Query_Triage.xlsx`. |
| OQ-6 | Is a Slack workspace / webhook available for a live alert demo? | AD-13 | **CLOSED** — moot, Slack cut. |
| OQ-7 | Include the optional n8n workflow artifact? (JD names n8n explicitly) | Phase 7 | **CUT** (descope rung 1) — stretch goal only if M6 lands by Mon morning. |
| OQ-10 | Does §4.1 ("any other text understanding step") oblige registry enrichment to run through Ollama, or may the reviewed registry ship as committed static config? | P2.3 | **ANSWERED: yes — both. AD-21 ACCEPTED.** Owner's rationale: strict §4.1 compliance, keeps the pipeline reusable if reviewers test a different company list, and removes any cloud LLM dependency from text understanding. |

---

## 11. Changelog (append-only)

| Date | Version | Change |
|---|---|---|
| 2026-08-02 | 0.9.7 | **Phase 6 dashboard built and verified against the live database while the backfill was still running.** `apps/api` is a read-only Express layer (database opened `readonly`, so the UI can never mutate a run's output) and `apps/web` is Vite + React 18 + Tailwind 4 + TanStack Query. **Verified end to end:** SPA served, bundle reachable, deep-route fallback working without swallowing `/api`, unknown slug returning a typed 404, and real data flowing — 258 companies, 500 mentions, 217 with no coverage, sentiment 302/121/77, Anthropic drilling down to 25 mentions. **Three UI decisions worth recording.** (1) `NO_COVERAGE` renders as a **dashed outline** and the company keeps its row — R5 makes it a first-class state and the coverage audit showed it is usually genuinely true, so it must read as an answer rather than a missing value. (2) Search uses **`useDeferredValue` rather than a debounce**: a debounce makes results arrive late, whereas deferring keeps them merely behind and lets React discard superseded work. (3) The **run-in-progress banner** — a backfill takes hours, so a dashboard reporting "217 companies with no coverage" mid-run tells the truth about the database and a lie about the portfolio; `/health` reports `runInProgress` and the hooks poll while it is true. Each mention shows the model's own one-line rationale beside its sentiment badge, because at 0.52 combined macro-F1 the label is not something a reader should take on trust. **Known trade-off:** the bundle is 658 kB (195 kB gzipped), dominated by Recharts; code-splitting the chart is the obvious fix if it matters. |
| 2026-08-02 | 0.9.6 | **Classification configuration frozen: `llama3.2:3b` + `classify.v1` (AD-32).** `DEFAULT_PROMPT_VERSION` reverted to v1 in code, so the shipped default and the measured winner are the same thing. The 0.80 exit criterion is **not met** — best combined macro-F1 is 0.522 — and that is recorded as a result rather than worked around. **P4.9 decided: AD-07's cascade stays CUT.** It would route low-confidence items to a larger model, but the largest model we can run is already ~7 hours for a production pass, so a cascade makes the run infeasible without addressing the discrimination gap the v1/v2 per-item diff exposed. M4 closes as *selected by evidence, bar not met*. |
| 2026-08-02 | 0.9.5 | **Prompt v2 evaluated against v1 on the same gold set — and the result says prompt engineering will not reach the bar.** Combined macro-F1, v1 → v2: `qwen2.5:3b-instruct` 0.496 → **0.577** (+0.081), `qwen2.5:1.5b-instruct` 0.497 → 0.450 (−0.048), `llama3.2:3b` 0.522 → 0.434 (−0.088). Best configuration overall is now **qwen2.5:3b-instruct + classify.v2 at 0.577**, still far below the 0.80 exit criterion. **The per-item diff is the finding.** For `qwen2.5:3b`, v2 fixed **13** items and broke **11** — and the split is perfectly clean: *every* fixed item was genuine coverage it had been rejecting (ZutaCore's $100M round, Innoviz's defence orders, Harvey's investment, Island's product launch) and *every* broken item was a decoy it now accepts (Peak the crypto token, the NBA's Launchpad, Ad ASTRA, "stop crime on the spot"). That is a **threshold slide, not a gain in discrimination**: inverting the doubt clause moved the operating point exactly as intended, and the model traded decoy rejection for coverage recall one-for-one. Relevance macro-F1 actually fell slightly (0.650 → 0.617) while sentiment rose sharply (0.343 → 0.538), because more genuinely relevant items now receive a sentiment at all. **Implication: further prompt iteration is not the lever.** A threshold move cannot buy both sides, and the homonym guidance demonstrably failed to teach the distinction it described — Launchpad and Peak remain wrong across every model and both prompts. **Cost side:** v2's longer prompt roughly halves throughput. Projected time for 2,500 items is now 235–421 min (`qwen2.5:3b`+v2 is ~7 hours), against 144–246 min for v1. JSON validity reached 100% for all three models under v2. Both runs are kept as `data/bakeoff.v1.json` and `data/bakeoff.v2.json`. |
| 2026-08-02 | 0.9.4 | **Bake-off run across the full §6.4 ladder — and the P4 exit criterion was NOT met.** 180 classifications, 60 gold items × 3 models. Combined macro-F1 (mean of the relevance and sentiment axes): `llama3.2:3b` **0.522**, `qwen2.5:1.5b-instruct` **0.498**, `qwen2.5:3b-instruct` **0.497**. The exit criterion is **≥0.80**; nothing is close, so **AD-17's ship rule does not apply** — it selects among models that clear the bar, and none do. Recording this as a measured negative result rather than shipping the least-bad number as though it passed. **Relevance is the failure, not sentiment.** Every model gets roughly a third of the relevance question wrong (17, 22 and 21 misses of 60), and the two 3B models fail in *opposite* directions: `llama3.2:3b` waves decoys through (irrelevant recall **0.24**) while `qwen2.5:3b` rejects genuine coverage (relevant recall **0.51** — it dropped "Liquid cooling co ZutaCore raises $100M"). Common-word names break all three: every model calls the NBA's Launchpad, a Eureka startup Launchpad and an arts LAUNCHPAD relevant. `llama3.2:3b` accepted **"Shield AI: $1.5 Billion Series G"** despite being handed the sector and the negative keyword `Shield AI`. **Two things that did work:** the Quantum Machines soft-passed article was classified correctly by all three models, vindicating AD-31; and JSON validity was 100% for both 3B models (95% for the 1.5B), so the schema and repair path hold. **A context-overflow hypothesis was tested and eliminated** — 777 input + 67 output tokens against a 1024 budget, so AD-18's setting is not the cause. Throughput measured: **144–246 min for 2,500 items**, well above the earlier 90–100 min estimate, because the classification prompt is far larger than the benchmark's. The harness now stores **per-item predictions** in `data/bakeoff.json`; an aggregate says a model is wrong, only the item list says how. |
| 2026-08-02 | 0.9.3 | **Gold set labelled and approved; README R9 and R13 written.** All 60 items carry a label and a note; the four items flagged as judgement calls were confirmed by the owner as drafted — Arrow Global irrelevant, Greenlight relevant/positive, the Innoviz registered direct offering **neutral** (now the precedent for every financing headline), and the Morphisec webinar **relevant** (vendor PR counts as a mention for B2B press monitoring). Final distribution: **39 relevant / 21 decoys**, and among the relevant **20 positive / 7 negative / 12 neutral**. **R9** now documents every provider limitation as a measured observation rather than an assumption — no snippet from either source, Google News ignoring boolean syntax, unresolvable redirect links, GDELT's 5-second limit and `seendate` lag, and genuine zero-coverage companies. **R13** discloses plainly that labels were AI-drafted and owner-reviewed, names the two things that keep the eval honest (the drafting assistant is not a bake-off candidate; labelling finished before any candidate saw the data), and states the **negative-class limitation**: with 7 items a single misclassification moves the score ~14 points, so negative figures are always reported with their support count and macro-F1 inherits the same caveat. |
| 2026-08-02 | 0.9.2 | **AD-31 soft-pass adopted, and the P4.1 gold-set candidates built from live data.** The pre-filter now *demotes* a qualifier miss to the LLM relevance gate rather than dropping it. Measured effect across the 57 approved companies: **zero-coverage 26 → 14** and **kept 282 → 572**, recovering twelve companies from a false `NO_COVERAGE`. Soft-passed items are counted separately (`stats['soft-pass']`, `result.softPassed`) so a run can report how much of its inference budget went to them. **Gold set (`packages/classifier/eval/gold-set.json`, `npm run gold:build`):** 60 items, 26 companies, **all labels null** — §8.4 Risk 1 requires labelling before anyone sees model output. Stratification is by *observable* features only (ambiguity tier, pre-filter verdict, loss-language in the headline), never by the answer, because sampling "12 negatives" would require deciding what is negative and make the eval circular. A planned `softpass-other` stratum was removed as structurally impossible: only human-approved queries are conjunctive and all 57 approved companies are critical or high, so every soft-pass is ambiguous-tier. The set records `inputShape` (`company` + `title`, headline only) so the eval cannot feed the model more context than production has. **246 tests passing.** |
| 2026-08-02 | 0.9.1 | **Pre-Phase-4 coverage diagnostic — Option A confirmed, but for different reasons than argued, and one finding that changes P4 design.** (1) **The `hl=en-IL` locale idea failed.** Byte-identical results across 10 companies: Google News ignores edition parameters on the `search?q=` endpoint. No config change made. (2) **Thin coverage is often genuine absence, not a provider gap.** OncoHost returns 0 articles in 90 days and its most recent coverage *anywhere* is 2026-03-24 — no third-party API can recover what does not exist. This retires the main argument for Option B and validates `NO_COVERAGE` (R5) as a correct product answer rather than a workaround. (3) **Zero-coverage baseline (`data/coverage-baseline.json`, `npm run audit:coverage`):** across the 57 human-approved companies, 1,038 candidates fetched, **282 kept**, **5 with zero candidates**, **26 keeping zero**. Rejections: 435 `no-name-match`, 28 `negative-keyword`, **293 `missing-qualifier`**. **(4) The finding that matters for P4:** the `missing-qualifier` bucket is not uniformly noise. `Astra` correctly rejects 18 articles about *OpenAI's* Astra model, but `Quantum Machines` drops a genuine article because the approved qualifier says `"quantum control"` while the headline says "Real-Time Control Strategy". Twelve of the 26 zero-kept companies had a qualifier do the rejecting. This is the AD-29 problem reaching human-approved queries: qualifiers were written assuming headline **+ snippet**, and P3.3 established there is no snippet. Proposed for P4: a qualifier failure should **demote an item to the LLM relevance gate rather than drop it**, since the name already matched — cost is roughly +293 classifications (~20 min). The gold set must therefore contain qualifier-failing items of *both* kinds or the eval will not measure the gate's hardest case. |
| 2026-08-02 | 0.9.0 | **PHASE 3 COMPLETE — M3 reached.** P3.8 adds an offline end-to-end integration test that replaces `globalThis.fetch` with a rejecting stub, so a regression reintroducing a live call **fails the suite** rather than quietly making CI depend on GDELT being up. It runs the full pipeline against the committed registry and the fixture corpus, asserts determinism (identical output across runs) and covers the collision, dedupe, no-coverage and dead-provider paths. **P3.7 hardened after a review question about GDELT recovery.** Three changes, all pointing the same way — spend as few requests as possible on an endpoint that has said stop: (1) **429 is no longer retryable.** It is an instruction, not a flaky failure; retrying it twice more is exactly what turned a burst into a multi-hour block on 2026-08-02. (2) **A 429 trips the circuit immediately** rather than waiting for three consecutive failures — previously a rate-limited GDELT could absorb up to 9 requests before we stopped asking; it now costs exactly 1 per run. (3) **Default cooldown raised 60 s → 5 min**, since the observed block outlasted a 75-second pause by hours. Recovery is automatic and unchanged in shape: open → cooldown → one half-open probe → success closes the circuit. Breaker state is per-process, so every fresh run also spends exactly one probe per provider. **244 tests passing.** |
| 2026-08-02 | 0.8.9 | **P3.7 — M3 REACHED. The collection pipeline runs end to end.** `collectForCompany` composes query builder → providers → normalise/dedupe → pre-filter → cap, and `npm run collect -- --company ZutaCore` is the milestone artifact: **12 deduped live articles returned while GDELT was failing**, which is the partial-failure isolation (R26) working rather than being asserted. `--providers fixture` runs the identical path offline, so a reviewer with no network still sees it work. A **per-provider circuit breaker** opens after consecutive failures and skips that provider until a cooldown elapses — without it a provider outage is rediscovered 258 times, each with its own retries. It is per provider precisely because the project's current situation is one source down and one healthy. Caps (A4) are applied **after** sorting by recency, because Google News returns relevance-ordered results and slicing first would let the cap choose by arbitrary position. **An honest limitation the demo surfaces:** the fixture corpus's Hailo taxi-app collision survives the pre-filter, because the model-generated negative keyword is the exact phrase `"Hailo taxi"` while the headline reads "Hailo, the taxi-hailing app". A human would have written `taxi`. That is the LLM relevance gate's job (AD-06), and it is further evidence for the AD-26/AD-29 theme that model-invented terms are too brittle to be load-bearing. **231 tests passing.** |
| 2026-08-02 | 0.8.8 | **P3.4 query builder — and a latent parser bug it exposed in the 57 human-approved queries.** The builder decides what to *send*, which is not always the registry string. **AD-30**: the query and the pre-filter share one predicate, because a measured A/B showed asymmetry loses both ways — sending unenforced qualifiers starved the fetch (Kando 5 kept → 0, Morphisec 3 → 1) while enforcing unsent ones dropped everything (Peak 6 → 0, Shield 2 → 0). **The bug:** `parseQuery` recognised only parenthesised OR-groups and treated every other quoted phrase as *required*. Against the committed registry that misread **16 of the approved queries** — `"Together AI" OR "Together Computer"` became a demand for both phrases, which no headline satisfies, and nested parentheses were matched by a regex that cannot nest, so `"Harvey AI" OR ("Harvey" AND ("legal AI" OR …))` collapsed into a group that was trivially true. Those queries are the output of an hour of human review, and misreading them looks exactly like "no coverage". Replaced with a real recursive-descent parser (`parseBooleanQuery` → `QueryNode` tree, `evaluateQuery`), which degrades a malformed query to a *broader* search rather than an empty one. Measured effect on live data: Morphisec 1 → 3 kept, and Harvey tightened 19 → 12 with the survivors now genuinely legal-AI coverage rather than whatever satisfied a broken group. **218 tests passing.** |
| 2026-08-02 | 0.8.7 | **P3.5 normalisation and cross-provider deduplication.** Raw provider items become storage-shaped `Article` rows: canonical URL, `article_id = sha256(canonical_url)`, publisher domain resolved from `<source url>` rather than the URL host, and a hard refusal of anything undated, titleless or unlinkable — an article with no date cannot sit in a quarter (R1) or drive last-mentioned (R4). **Dedupe uses two keys.** The URL hash is primary and collapses the same article seen with different tracking tails. A content key — (normalised title, publisher domain) — is the fallback that AD-28 forced: Google News URLs are opaque redirects, so the same story from two providers hashes differently and a URL-only dedupe would never merge it. Where two records describe one story, the survivor is the one with a **resolvable publisher link**, because R3 requires a reader to reach the source. **This refines AD-28:** dates are compared within a **7-day tolerance** rather than for equality, since GDELT's `seendate` lags a publisher's `pubDate` — requiring equal dates would break exactly the cross-provider merge the key exists for. Wire copy at two different outlets stays two mentions, each with its own link. Skips and duplicates are returned with reasons rather than vanishing. **GDELT re-probed and still HTTP 429** on a single request, hours after the original burst — this is persistent for this network, not a cooldown, so Google News remains the only live-verified source and that belongs in the README under R9. **204 tests passing.** |
| 2026-08-02 | 0.8.6 | **P3.6 deterministic pre-filter — pulled ahead of P3.4 and measured on live traffic.** Four layers in ascending cost order: blocked domain, whole-word name/alias match, whitespace-sensitive negative keywords, and **client-side re-application of our own boolean query** — the last one added specifically because P3.3 proved Google News does not honour `AND (...)`. Every rejection carries a machine-readable reason *and the term that caused it*, so precision can be measured rather than asserted (§4.3 layer 5); these feed `mentions.rejection_reason`. New `npm run measure:prefilter` runs the whole thing against live queries. **Measured: 42% of candidates dropped for zero inference cost**, inside the 40–60% §6.4 predicted. **AD-29** came directly out of that measurement — enforcing the model's invented qualifiers left Morphisec with **0 kept from 10**, so qualifier enforcement is now gated on `querySource === 'human-approved'`, which recovered a genuine article. **What the measurement also shows, and the README must not hide (R9):** the pre-filter is necessary but nowhere near sufficient. `Shield` still keeps two articles about a football club, because the *human-approved* qualifier list literally contains `"Shield FC"`; `Peak` still keeps a crypto-token article matching `"Peak AI"`. Headline-only text (the P3.3 finding) is the root cause in both directions — too little text for a real qualifier to appear, and enough coincidence for a bad one to match. The LLM relevance gate (AD-06) is therefore load-bearing, exactly as §4.3 layer 4 intended. **184 tests passing.** |
| 2026-08-02 | 0.8.5 | **P3.3 Google News RSS provider — the first source verified end-to-end against live traffic.** 20 tests, including parsing a real feed captured on 2026-08-02 and committed as a fixture. The request throttle was extracted from the GDELT provider into `createThrottle` now that two providers need it. **AD-27** adds `fast-xml-parser` (the only new production dependency; pure JS, so AD-23 still holds) — chosen over a regex reader because the feed emits numeric entities like `&#39;` constantly and silently leaving them in corrupts headlines before they reach the classifier. **AD-28** drops redirect resolution: the `guid` is an opaque token and the link returns a JS interstitial rather than a redirect, so P3.5 needs a (title, domain, date) dedupe key alongside the URL hash. **Two findings that change what matters next.** (1) *Neither provider returns a snippet* — GDELT's ArtList has no such field and Google's `<description>` is an anchor tag plus a publisher name — so classification is **headline-only** unless A6's opt-in body extraction is built; this lands on P4.2 prompt design and the gold set. (2) *Google News does not honour our boolean query semantics.* A live run of the human-approved query `"Peak" AND ("decision intelligence" OR "supply chain")` returned **five results, none about Peak**, and `"Kando"` returned a yacht, a video game and a singing competition. GDELT respects exact-phrase queries; Google News treats them as loose keywords. The 57 hand-approved queries therefore buy far less precision on this provider than on GDELT, which makes **P3.6 the highest-value remaining task in Phase 3** — precision now has to come from the deterministic pre-filter, not the query builder. Per-provider precision should be measured separately in the README (R9). **163 tests passing.** |
| 2026-08-02 | 0.8.4 | **P3.2 GDELT provider built and offline-tested — and a live-traffic finding that changes P3 sequencing.** The provider translates a `SearchRequest` into DOC 2.0 params, self-throttles, retries with jittered backoff on 429/5xx/transport, and refuses to retry a rejected query or a caller-initiated abort. It re-checks the window client-side rather than trusting the remote end, drops undated items on the same rule as the fixture provider, and maps GDELT's language *names* to codes while passing unknown ones through untouched. 25 offline tests, all against an injected `fetch`. `withRetry` moved from `@oc/ollama` to `@oc/core` — the collector needs it and collector→ollama is the wrong dependency direction. **Two things were learned only by calling the real API.** (1) `startdatetime` is `YYYYMMDDHHMMSS` with **no `T`**; the unit test caught my formatter sending one. (2) GDELT's rate limit is stated *nowhere except inside its own 429 body* — "one request every 5 seconds" — so the default spacing is now 5 s, evidence not guesswork, which puts a **floor of ~22 minutes on a 258-company collection pass** and is a scheduling input for P8.1. **Unresolved and important:** this machine now receives HTTP 429 from GDELT for a *single* request after 75 s of silence, so the live path is **unverified end-to-end**. That is the exact risk named in the P3 exit criteria, and it promotes P3.3 (Google News RSS) from secondary to the only source we can currently prove works. A `--record` fixture capture from GDELT is blocked until this clears. **143 tests passing.** |
| 2026-08-01 | 0.8.3 | **P3.1 merged — the data-collection seam exists.** `packages/collector` adds the `NewsProvider` interface (R15, AD-05), a small boolean query matcher, and an offline `FixtureProvider` over a 24-item corpus. Providers are deliberately dumb: they turn a query into raw items and do not canonicalise URLs, judge relevance, or retry — those belong to P3.5, P3.6 and P3.7 respectively, which is what keeps GDELT, RSS and fixtures interchangeable. Two design points worth carrying forward: fixture dates are **relative** (`-3d`) so the corpus can never age out of the rolling 90-day window (A1), and **undated items are dropped rather than guessed at**, because an article with no date cannot be placed in a quarter (R1) or drive last-mentioned (R4). The corpus is **hand-authored and labelled as such** in its `_provenance` field — it is not recorded traffic, and the README must not describe it as such until P3.2 lands a `--record` capture. **118 tests passing.** |
| 2026-08-01 | 0.8.2 | **M2 REACHED — full 258-company Ollama enrichment run, and the P4.0 CPU benchmark.** Enrichment: 258 companies on `llama3.2:3b`, **0 failures**, 10 cache hits / 248 misses. Provenance: 57 human-approved · 130 llm-enriched · 71 triage-default · 0 fallback. Sectors rose from 103 to 198; 70 rows carry a domain, 119 an alias. **AD-26 discarded 91 of 258 enrichments (35%)** — overwhelmingly `known: false`, matching the 40% seen in the 10-company sample. A full-scale audit of the committed artifact found **zero unrelated aliases and zero unrelated domains**; the three apparent self-negations (`Launchpad`/"launch pad", `Greenlight`/"green light", `Wayup`/"way up") are human triage entries that discriminate by spacing on purpose, which is now recorded as a **hard constraint on the P3.6 pre-filter** in §4.3. Benchmark (AD-25, `data/benchmark.json`): `llama3.2:3b` on CPU peaks at **concurrency 3 — 59.6 items/min, ~19 tok/s**, with concurrency 6 *slower* than 3, confirming the AD-18 prediction that the optimum sits at 2–4 on a bandwidth-bound machine. tok/s is flat across all three concurrency levels, which is the bandwidth ceiling made visible. **Caveat recorded, not buried:** the bench schema emits ~17 output tokens while the real classification schema emits ~60–90, so the "33.5 min per 2,000 items" projection is optimistic by roughly 3×; the number to plan P8.1 against is ~90–100 min until P4.2 exists and the bench is re-run against the real prompt. OQ-8 partially answered — CPU shipped by measurement, the GPU backends consciously left unmeasured. |
| 2026-08-01 | 0.8.1 | **First live Ollama enrichment pass (P2.3) run on `llama3.2:3b`, and two defects it exposed, fixed.** (1) `npm run enrich -- --limit 10` wrote to the default `--out`, truncating `data/companies.json` from 258 records to 10 — a graded deliverable (R8/R24) silently destroyed by a dev loop. A partial run now writes `data/companies.sample-<n>.json` and says so; the guard is unit-tested in `test/enrich-args.test.ts`. (2) **AD-26 added** — model output is now sanitised before it can reach the registry. The pass returned `known: false` for 4 of 10 companies while still emitting confident aliases, sectors and negative keywords for them; among the survivors, Stripe was aliased to `"PayPal"`, OncoHost's negative keyword was its own name, and OpenEvidence's domain was invented. Registry rebuilt to 258 records (57 human-approved, 201 triage-default). **95 tests passing.** The repository is now under git. |
| 2026-08-01 | 0.8.0 | **P4.0 benchmark tool built** (`npm run bench`, AD-25). The Ollama client now surfaces server-reported timings — `load_duration`, `prompt_eval_*`, `eval_count`, `eval_duration` — converted from nanoseconds once, at the boundary, so tokens/sec is measured rather than inferred from wall clock. The benchmark sweeps models × concurrency across two output-size profiles (`enrich` 256 tokens, `classify` 96), discards a warm-up per configuration, and projects the wall time of a 2,000-item classification run. Writes `data/benchmark.json`; the printed table is the README artifact required by R11/R13. **80 tests passing.** |
| 2026-07-31 | 0.7.0 | **AD-23: swapped `better-sqlite3` for `node:sqlite`** after `npm install` failed on the owner's Windows machine with a node-gyp error (no Visual Studio C++ Build Tools). Zero native compilation, zero third-party storage dependency; `db.transaction()` replaced by a nest-safe SAVEPOINT helper. **AD-24: the Ollama client was pulled forward from P4.1 into P2**, since registry enrichment needs it too — de-risks the critical path two days early. **P1 complete, P2 code complete.** New: `packages/ollama` (structured output, deterministic options, jittered retry, content-hash cache, concurrency limiter, health check) and `packages/registry` (seed parsing, enrichment schema, query construction with auditable provenance). `data/companies.json` generated: 258 records, 57 human-approved queries. **77 tests passing.** Provenance labelling corrected mid-build — rows sharing a file with reviewed rows are `triage-default`, not `human-approved`. |
| 2026-07-31 | 0.6.0 | **M0 REACHED — AD-01…AD-22 frozen to ACCEPTED.** The 57 flagged company queries were approved by the owner and become `queryOverride` ground truth (P2.7); `scripts/enrich-companies.ts` still regenerates the registry through local Ollama for any other seed list (AD-21). **P1 scaffold built and verified:** npm workspaces, TypeScript strict, ESLint 9 flat config, Prettier, Vitest, pino logging, zod-validated config, typed error hierarchy, deterministic id/URL canonicalisation, SQLite schema with idempotency constraints, six repositories, status bucketing, walking skeleton (P1.8), GitHub Actions CI (P1.9) and a `docs:check` gate that fails the build on documentation drift. **46 tests passing.** This file and `ai_prompts.md` now live inside the repo and are the versioned source of truth. |
| 2026-07-31 | 0.5.0 | **OQ-10 answered — AD-21 ACCEPTED.** Registry enrichment runs through local Ollama via `scripts/enrich-companies.ts` *and* commits its hand-reviewed output, satisfying §4.1 under the strictest reading and keeping the pipeline reusable for any seed list. P2.3 renamed and rescoped accordingly; P2.7 added to apply approved query overrides. P2.4 now blocked on owner approval of the 57 flagged names. Review artifact `company_query_review.md` added alongside the xlsx. All decisions except AD-03…AD-22 pending the P2.4 sign-off are otherwise ready to freeze. Still no code written. |
| 2026-07-31 | 0.4.0 | **OQ-1, OQ-3, OQ-4, OQ-5 answered.** Deadline Tue 4 Aug 16:00, target submission Mon 3 Aug evening → added §8.6 calendar with hard checkpoints and a cut-on-slip rule. AD-02 (TypeScript) promoted to ACCEPTED. Descope rungs 1–3 marked CUT (n8n, cascade, Slack). Added AD-21 (registry ships as *both* an Ollama script and committed reviewed config, closing the §4.1 compliance question) and AD-22 (triage on two axes: ambiguity vs volume). Full 258-company query triage completed and delivered for review — **57 flagged CRITICAL/HIGH, not the ~40 estimated**; 19 separately flagged high-volume. New OQ-10 raised. Still no code written. |
| 2026-07-31 | 0.3.0 | **§8 work plan rewritten to a professional structure.** 9 phases, each with objective, demonstrable milestone (M0–M8), numbered sub-tasks (`P<phase>.<n>`), requirement traceability (`Satisfies R#`), hour estimates, objective exit criteria and named risks. Added §8.0 conventions + global Definition of Done, §8.2 critical path and parallelisation (P4 runs against fixtures in parallel with P2/P3), §8.3 pre-declared descope ladder with a never-cut list, §8.5 progress dashboard. Added walking-skeleton task P1.8 and backend-benchmark task P4.0. Total estimated effort ~51 focused hours. Still no code written. |
| 2026-07-31 | 0.2.0 | OQ-2 answered (Intel Arc 140V / 32 GB / Windows 11). Added AD-17 (right-sizing by measurement), AD-18 (inference-parameter right-sizing), AD-19 (Intel Arc backend benchmark), AD-20 (encoder alternative considered & rejected). **AD-07 downgraded to CONDITIONAL/default-OFF** — the cascade is now evidence-gated rather than assumed. Added §6.4 model-selection protocol and the model ladder. Added assumptions A9, A10 and open questions OQ-8, OQ-9. Env vars extended with right-sizing knobs. Still no code written. |
| 2026-07-31 | 0.1.0 | Initial creation. Planning phase. Architecture proposed, 7 open questions raised. No code written. |

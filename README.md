# OurCrowd Press Monitor

Monitors press coverage for OurCrowd portfolio and fund companies, classifies each
mention's sentiment with a **locally hosted Ollama model**, and presents the results in a
dashboard with a daily new-coverage alert.

> **Status: in development.** Sections marked _(pending)_ are filled in as their phase
> completes — see `project_context.md` §8 for the roadmap and current milestone.
> No cloud LLM is used anywhere in this project.

---

## Quickstart

```bash
# 1. prerequisites: Node.js >= 22.13 (24 recommended) and Ollama running locally
node --version
ollama --version

# 2. install - no native compilation, no build tools required
npm install

# 3. verify the toolchain (lint + typecheck + 77 tests + docs consistency)
npm run verify

# 4. prove every stage seam fits, end to end, with stubs
npm run skeleton

# 5. build the company registry through the local model
ollama serve                    # in another terminal
ollama pull llama3.2:3b
npm run enrich                  # -> data/companies.json

#    ...or without Ollama, from the human-approved query triage alone:
npm run enrich -- --offline
```

_(Full end-to-end run commands: pending — task P8.4.)_

---

## What this project does

Three outputs, one pipeline:

1. **Quarterly press dashboard** — every company's press appearances over a rolling
   90-day window, each mention classified `positive` / `negative` / `neutral` and linked
   to its source article.
2. **Current mention status** — per company, how long since it was last in the news.
   Companies with **no coverage at all** are a visible state, not an absent row.
3. **Daily alert** — a scheduled, idempotent job that detects genuinely new mentions and
   emits an alert.

```
companies.json → COLLECT → NORMALIZE/DEDUPE → PRE-FILTER → CLASSIFY (Ollama) → PERSIST
                                                                                   ↓
                                                      AGGREGATE ─── EXPORT ─── ALERT
                                                          ↓
                                                  Express API ⇄ React dashboard
```

## Project structure

| Path | Purpose |
|---|---|
| `packages/core` | Shared kernel — config, logging, typed errors, domain types, SQLite storage |
| `packages/ollama` | The only LLM code path: structured output, retries, cache, concurrency |
| `packages/registry` | Company registry — seed parsing, enrichment schema, query construction |
| `packages/collector` | News collection behind a provider interface _(pending — P3)_ |
| `packages/classifier` | Classification prompt and evaluation harness _(pending — P4)_ |
| `packages/pipeline` | Stage orchestration, run manifests, exports _(pending — P5)_ |
| `packages/alerting` | Alert sinks behind a common interface _(pending — P5/P7)_ |
| `apps/api` | Read API for the dashboard _(pending — P6)_ |
| `apps/web` | React + Vite dashboard _(pending — P6)_ |
| `apps/scheduler` | Daily job scheduling _(pending — P7)_ |
| `scripts/` | CLI entry points |
| `prompts/` | Versioned runtime prompts sent to Ollama |
| `data/` | Committed output of a successful run |
| `project_context.md` | Living architecture, decisions, roadmap and traceability matrix |
| `ai_prompts.md` | Verbatim log of prompts used with AI coding assistants |

## Setup

### Requirements

- **Node.js >= 22.13** (24 recommended). Storage uses the built-in `node:sqlite`
  module, so there is no native addon to compile and no C++ build tools to install.
- [Ollama](https://ollama.com) running locally

### Ollama

```bash
ollama serve
ollama pull llama3.2:3b     # confirmed by the model bake-off — see below
```

> **Intel Arc note.** Ollama has no official Intel Arc acceleration path. Vulkan support
> is opt-in and experimental (`OLLAMA_VULKAN=1`) and Intel ships a separate IPEX-LLM
> build. The measured comparison for this project is recorded below _(pending — P4.0)_.
> The pipeline is sized to complete on **CPU alone**, so any reviewer can run it.

### Environment

Every variable has a working default — copy `.env.example` to `.env` only to override.

## Data sources and their limitations

Two providers sit behind one `NewsProvider` interface, plus an offline fixture provider.
Neither live source needs an API key, which is deliberate: a reviewer can clone this repo and
get real data without signing up for anything.

| Provider | Role | Status |
|---|---|---|
| **Google News RSS** | Primary in practice | Verified live end to end |
| **GDELT DOC 2.0** | Intended primary (honours exact-phrase boolean queries) | Code-complete, **rate-limited from this network since 2026-08-02** |
| **Fixture** | Offline corpus | `NEWS_PROVIDERS=fixture` runs the whole pipeline with no network |

**Measured limitations.** Every item below was observed, not assumed.

- **Neither provider returns a snippet.** GDELT's `ArtList` has no such field, and Google
  News's `<description>` is an anchor tag plus a publisher name. **Classification therefore
  runs on the headline alone — roughly ten words.** This is the single biggest constraint on
  accuracy in the whole system.
- **Google News does not honour boolean query syntax.** A live search for
  `"Peak" AND ("decision intelligence" OR "supply chain")` returned five articles, none about
  Peak. The pipeline re-applies its own query client-side (`packages/collector/src/pre-filter.ts`)
  because that is the only place the semantics reliably hold.
- **Google News article links are unresolvable redirects.** The `guid` is an opaque token and
  following the link returns a JavaScript interstitial, not a redirect. The Google URL is
  stored (it does open the article) and the publisher domain is recorded separately so the
  same story from two providers still deduplicates.
- **GDELT's rate limit is one request per 5 seconds**, stated nowhere except inside its own
  429 body. At 258 companies that is a floor of ~22 minutes per collection pass.
- **GDELT's `seendate` is when its crawler saw an article, not the publication date.**
  Cross-provider dedupe compares dates within a 7-day tolerance for this reason.
- **Coverage skews to indexed online news.** Paywalled and subscription outlets are
  under-represented, and the feed is relevance-ordered and capped at ~100 items.
- **Some companies genuinely have no recent press.** OncoHost returns zero articles in a
  90-day window, and its most recent coverage anywhere is 2026-03-24. `NO_COVERAGE` is a
  correct answer here, not a bug — see `data/coverage-baseline.json`.

## The local LLM

- **Model used, and why** — _(pending — P4.8)_
- **How it is invoked** — prompt structure and expected output format — _(pending — P4.2)_
- **How classification quality was validated** — see below. _(Confusion matrix and macro-F1 land with P4.7.)_

### Validating classification quality (R13)

Quality is measured against a 60-item gold set at `packages/classifier/eval/gold-set.json`.

**How it was built.** Items were sampled from **live Google News results**, not written by
hand, so the eval measures the input the system actually receives. Stratification uses only
*observable* features — company ambiguity tier, pre-filter verdict, and loss-language in the
headline — never the answer. Sampling "twelve negatives" would require first deciding what is
negative, which is precisely the circularity that makes an evaluation worthless.

| Stratum | n | What it tests |
|---|---|---|
| `kept-distinctive` | 18 | Baseline relevance and the sentiment spread |
| `kept-ambiguous` | 14 | Decoys the deterministic pre-filter cannot catch |
| `softpass` | 20 | Items kept only because a qualifier miss demotes rather than drops |
| `negative-signal` | 8 | The rubric's rarest class |

Labels: **39 relevant / 21 irrelevant**; among the relevant, **20 positive, 7 negative,
12 neutral**. Input to the classifier is exactly `company` + `title` — the file records this
as `inputShape` so an evaluation cannot feed the model more context than production has.

**Disclosure — how the labels were produced.** Labels were **drafted by an AI assistant
(Claude) and reviewed, corrected and approved by the project owner**. This is weaker than a
set hand-labelled from scratch and is stated here rather than glossed over. Two mitigations
apply: the drafting assistant is **not** the model under evaluation (`llama3.2:3b` and the
other bake-off candidates), so the evaluation is not self-referential; and all labelling was
completed **before any candidate model saw the data**, which is what stops a gold set from
quietly becoming a description of model behaviour.

**Known limitations of this gold set.**

- **The negative class has only 7 items.** Negative press is genuinely rare in a 90-day
  window, and stratifying on observable features cannot manufacture it. Per-class precision
  and recall for `negative` therefore carry a **wide confidence interval** — a single
  misclassification moves the score by roughly 14 points. Negative-class figures are reported
  **with their support count** and must not be read as a stable estimate. Macro-F1, which
  weights all three classes equally, inherits that instability and is quoted with the same
  caveat.
- Items come from Google News only, since GDELT has been rate-limited from this network.
- 60 items is small. It is enough to separate a model that works from one that does not; it
  is not enough to rank two close models confidently.

### Model selection

_(pending — the bake-off table from task P4.8 lands here.)_

## Running end to end

_(pending — P8.4.)_

## The `data/` folder

_(pending — populated by the production run, task P8.1.)_

## Assumptions, trade-offs and known limitations

Recorded as they are made in `project_context.md` §4 and §5; consolidated here at delivery
_(pending — P8.4)_. Notable ones already decided:

- **"Last quarter" means a rolling 90-day window**, not a calendar quarter (configurable).
- The supplied company list contains **names only**, though the task document describes
  "name + any identifying detail" — the registry is enriched to compensate.
- **57 of the 258 company names are ambiguous enough** that a bare-name news query returns
  mostly noise. Query construction and relevance filtering address this explicitly.

## Development

```bash
npm run verify      # lint + typecheck + test + docs consistency
npm run test:watch  # tests in watch mode
npm run skeleton    # walking skeleton across every stage seam
npm run db:migrate  # apply the schema
npm run enrich      # rebuild data/companies.json (add --offline to skip Ollama)
npm run bench       # measure local inference throughput -> data/benchmark.json
```

### Measuring inference throughput

`npm run bench` sweeps models against client concurrency and reports p50/p95 latency,
tokens/sec (from Ollama's own timings, not wall clock), and the projected wall time of a
full 2,000-item classification run.

```bash
npm run bench                                                  # default model, c = 1/3/6
npm run bench -- --models llama3.2:3b,qwen2.5:1.5b             # model bake-off
npm run bench -- --profile enrich --concurrency 1,3,6,10       # longer outputs
```

Latency and throughput are different questions: a warm-up call is discarded per
configuration so model-load time never lands in a sample, and per-request latency is
reported separately from items/minute.

### Company registry

`data/companies.json` is built by `scripts/enrich-companies.ts`. Every row records
**where its search query came from**:

| `querySource` | Count | Meaning |
|---|---|---|
| `human-approved` | 57 | A person reviewed and signed off this query (the CRITICAL/HIGH names) |
| `llm-enriched` | — | Built from local-Ollama enrichment output |
| `triage-default` | 201 | Generated query for an unreviewed MEDIUM/LOW name |
| `fallback` | — | Bare exact phrase; nothing else was available |

The script works on any seed list (`--seed <path>`), so the pipeline is not tied to the
258 companies supplied with this task.

## Licence

MIT

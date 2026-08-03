# ADR-0032 — Ship a model that missed the accuracy bar, and say so

**Status:** Accepted · **Date:** 2026-08-02

## Context

Phase 4's exit criterion was explicit: **the selected model must reach ≥0.80 macro-F1 on the
gold set.** The bake-off produced:

| Model | Relevance F1 | Sentiment F1 | Combined |
|---|---|---|---|
| `qwen2.5:1.5b-instruct` | 0.650 | 0.345 | 0.498 |
| `llama3.2:3b` | 0.531 | 0.513 | **0.522** |
| `qwen2.5:3b-instruct` | 0.650 | 0.343 | 0.497 |

Nothing was close. A second prompt was written against the specific failures and re-evaluated:
`qwen2.5:3b` + v2 reached **0.577**, still far below the bar.

## Decision

Ship **`llama3.2:3b` + `classify.v1`**, state the miss in the README's opening table, and stop
iterating on the prompt.

## Rationale

**Why not the higher-scoring configuration.** `qwen2.5:3b` + v2 scores 0.577 but projects to
~7 hours for a production run against 233 minutes, because v2's longer prompt roughly halves
throughput. With Phases 5–8 unbuilt, a run that cannot finish is not a candidate.

**Why stop iterating.** The per-item diff is the argument. Moving from v1 to v2 on `qwen2.5:3b`
**fixed 13 items and broke 11**, and the split was perfectly clean: *every* fix was genuine
coverage it had been rejecting, *every* break was a decoy it now accepted. That is a threshold
slide, not improved discrimination. A third prompt would re-tune the same knob. The homonym
guidance also demonstrably failed to teach the distinction it described — Launchpad and Peak stay
wrong across every model and both prompts.

**Why not silently apply the ship rule.** ADR-0017's rule selects the smallest model within 2
points of the best *among models that clear the bar*. Applying it to a field where none do would
produce a sentence that reads like a decision and means "we picked the least bad one". The
evaluation harness exists precisely to prevent that.

**Why ship at all.** The brief states that a partially complete solution with clear notes is
preferred to an undocumented "complete" one. A working pipeline with a measured, documented
0.52 is more useful — and more honest — than the same pipeline with no evaluation behind it.

## Consequences

- The README leads with the miss rather than burying it.
- The production spot-check quantified what 0.52 means in practice: **~85% weighted relevance
  precision, ≈198 false positives among 1,352 published mentions**, and a systematic optimism
  bias in sentiment.
- The V2 roadmap addresses the root cause — ten words of headline — rather than proposing a
  bigger model, because the per-item evidence says size is not the binding constraint here.
- ADR-0007's cascade stays cut: it routes low-confidence items to a *larger* model, and the
  largest model we can run is already too slow.

## The general principle

An evaluation you are only willing to report when it flatters you is not an evaluation. This
project's most defensible artifact is the table showing it did not hit its own target.

# ADR-0017 — Model selected by bake-off, ascending from the smallest

**Status:** Accepted · **Date:** 2026-07-31

## Context

The task is 3-class sentiment plus a binary relevance judgement over a short headline. The
default instinct is to reach for the largest model that fits in memory. That instinct is an
opinion, and this project needed it to be a measurement.

## Decision

Establish the quality bar first (≥0.80 macro-F1 on a gold set), then climb a ladder from the
smallest candidate upward and **stop at the first rung that clears it**:

| Rung | Model | q4 size |
|---|---|---|
| 1 | `qwen2.5:1.5b-instruct` | ~1.0 GB |
| 2 | `llama3.2:3b` | ~2.0 GB |
| 3 | `qwen2.5:3b-instruct` | ~1.9 GB |

Ship rule: the smallest model within 2 points of macro-F1 of the best.

## Rationale

The model is a dependency like any other, and the correct size is the smallest one that meets
the bar. Asserting "a 7B is better" is an opinion; a bake-off table is evidence.

Parameter count is also not the only lever, and the others are free: `num_ctx: 1024` instead of
the 4096 default, `num_predict: 96`, a rationale capped at 15 words, and a measured
`OLLAMA_CONCURRENCY` of 3. The benchmark showed concurrency 6 is *slower* than 3 on this
hardware — a bandwidth ceiling made visible, and a setting that would have been guessed wrong.

## Consequences

The ladder produced an uncomfortable result: **no rung cleared the bar.** Best combined macro-F1
was 0.522 against a 0.80 criterion.

The ship rule selects *among models that clear the bar*. Since none did, it was not applied
mechanically to make a failure look like a decision — see ADR-0032.

The bake-off still did its job. It ruled out "we just picked the wrong size", quantified the gap,
and produced the per-item data that showed prompt iteration was moving a threshold rather than
improving discrimination. A project that shipped on vibes would have discovered the false
positives in production instead.

## Related

- ADR-0032 — shipping below the bar
- `data/bakeoff.v1.json`, `data/bakeoff.v2.json` — full per-item results

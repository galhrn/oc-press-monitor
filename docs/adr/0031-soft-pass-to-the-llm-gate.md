# ADR-0031 — A qualifier miss demotes to the LLM gate instead of dropping

**Status:** Accepted · **Date:** 2026-08-02

## Context

The deterministic pre-filter re-applies our own boolean query client-side, because Google News
demonstrably does not honour it. For a human-approved query like
`"Quantum Machines" AND (OPX OR "quantum control" OR Israeli OR funding)`, an article that names
the company but matches no qualifier was rejected.

Measured across the 57 human-approved companies, **293 items** were rejected on that rule alone,
and **26 companies kept nothing at all**.

Inspecting the bucket showed it was not uniformly noise:

- `Astra` correctly lost 18 articles about *OpenAI's* Astra model.
- `Quantum Machines` lost *"Quantum Machines Highlights Real-Time Control Strategy for
  Fault-Tolerant Quantum Computing"* — genuine coverage — because the approved qualifier says
  `"quantum control"` and the headline said "Real-Time Control Strategy".

## Decision

A qualifier miss **soft-passes**: the item is kept, flagged, and sent to the LLM relevance gate
rather than dropped. Soft passes are counted separately so a run can report how much of its
inference budget went to them.

## Rationale

The company name already matched, so this is precisely the ambiguous case the relevance gate
exists for. §6.4 is explicit that the pre-filter's job is to cut **cost**, not correctness.

The root cause is upstream: those qualifiers were written assuming headline **+ snippet**, and
neither provider returns a snippet. We are testing a four-word phrase against ten words of
headline. Requiring `"Endpoint Security"` to appear in a ten-word headline is not a filter, it
is a guarantee of silence.

## Consequences

| | Before | After |
|---|---|---|
| Companies keeping zero | 26 | **14** |
| Articles kept | 282 | **572** |

Twelve companies recovered from a **false** `NO_COVERAGE` — the worst possible error for this
product, because it is indistinguishable from the true one.

The cost is ~290 extra classifications per run, and a lower-precision input to the LLM gate. The
spot-check later measured what that costs in practice: ~85% weighted precision.

## Rejected alternative

Tightening the qualifiers instead. They are human-approved artifacts of an hour of review; the
problem is not their quality but the amount of text they are being matched against.

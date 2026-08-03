# ADR-0026 — Model output is filtered before it can reach the registry

**Status:** Accepted · **Date:** 2026-08-01

## Context

`scripts/enrich-companies.ts` asks a local model to enrich 258 bare company names with aliases,
sector, domain and negative keywords. The plan already said enrichment was "advisory, never
authoritative" and that hand-review was not optional.

Then the first live pass ran on ten companies, and the failures were systematic rather than
random:

| Company | Model output | Reality |
|---|---|---|
| Stripe | alias `"PayPal"` | a competitor |
| OncoHost | negative keyword `"oncohost"` | its own name |
| OpenEvidence | domain `opeven.com` | nobody |
| Maolac | "Vietnam, banking, finance" | Israeli foodtech |
| 3 rows | `sector: "null"` (the string) | — |

The OncoHost case is the instructive one. A negative keyword equal to the company's own name
would have made the pre-filter reject **100% of its genuine coverage**, silently, and the
dashboard would have shown a real company as having no press.

## Decision

`sanitizeEnrichment` filters model output before it can influence the registry:

- `known: false` discards the record entirely
- aliases and domains must resemble the company name
- a negative keyword contained *in* the company name is dropped
- `"null"` as prose reads as absent

A discarded enrichment demotes the row to `triage-default` rather than being recorded as a
source that contributed nothing.

## Rationale

"Advisory, never authoritative" was written as an intention. An intention does not filter a
negative keyword. The rule had to become code.

The `known: false` discard is the aggressive part and the one worth defending: the model told us
it does not recognise the company, so everything else in that response is a guess about a company
it cannot name. Across the full run this discarded **91 of 258 enrichments (35%)** — which is
itself a publishable measurement about what a 3B model knows about a private VC portfolio.

## Consequences

- A full-scale audit of the committed registry found **zero unrelated aliases and zero unrelated
  domains**.
- Each rule has a regression test named after the response that motivated it.
- The negative-keyword check is deliberately one-directional: `"together"` is dropped for
  *Together AI*, while `"Peak District"` survives for *Peak*.

## The theme this started

The same shape recurred twice more: ADR-0029 (do not enforce model-invented query qualifiers)
and ADR-0031 (a qualifier miss demotes rather than drops). Model output is input to a judgement,
never a filter.

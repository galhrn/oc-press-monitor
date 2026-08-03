# Architecture Decision Records

The complete decision table — 32 entries, each with a one-line rationale — lives in
`project_context.md` §5 and is the authoritative index. The records here are the long-form
"why" for the decisions that either changed the shape of the system or were reversed by
evidence.

They are written after the fact, from the measurements that drove them. Where a decision was
made on a guess and later corrected, the record says so rather than presenting the final answer
as though it had been obvious.

| ADR | Decision | Why it earned a record |
|---|---|---|
| [0005](0005-keyless-news-providers.md) | Keyless news providers behind one interface | The constraint that shaped collection, and the one that survived a provider going down |
| [0017](0017-right-sizing-by-measurement.md) | Model chosen by bake-off, ascending from the smallest | The central engineering claim of the project |
| [0023](0023-node-sqlite.md) | `node:sqlite` instead of `better-sqlite3` | A predicted risk that fired on day one |
| [0026](0026-sanitise-model-output.md) | Model output is filtered before it can reach the registry | Ten sample rows changed how the whole enrichment pipeline is trusted |
| [0031](0031-soft-pass-to-the-llm-gate.md) | A qualifier miss demotes to the LLM gate instead of dropping | Recovered twelve companies from a false "no coverage" |
| [0032](0032-ship-below-the-bar.md) | Ship a model that missed the accuracy bar, and say so | The hardest call in the project |

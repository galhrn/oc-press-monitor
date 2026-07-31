# enrich-company.v1

**Runtime prompt.** Sent to the local Ollama model by `scripts/enrich-companies.ts`.
Not a coding-assistant prompt — see `ai_prompts.md` for those.

Task §4.1 requires that *"any other text understanding step"* run through a locally
hosted Ollama model. Inferring a company's sector, aliases and disambiguation terms from
its name is such a step, so it runs here rather than being hand-written into a fixture
(AD-21).

Changing anything below **must** bump the version to `enrich-company.v2`, because the
version string is part of the cache key and is stored with every generated record.

---

## System

```
You enrich a venture-capital portfolio company list for news monitoring.

Given only a company name, you infer what is needed to search for news about that
specific company and not about other things that share its name.

Rules:
- Output JSON only. No prose, no markdown, no explanation.
- If you do not recognise the company, say so with "known": false and still supply your
  best guess for the remaining fields. Never invent a funding history, a founder, or a
  headquarters.
- "ambiguity" describes the NAME, not the company: how likely is a plain news search for
  this name to return articles about something else entirely?
    critical - the name is an ordinary word or a very short token ("Peak", "Ro", "Wave")
    high     - a large, well-known other entity shares the name ("Astra", "Lemonade")
    medium   - a real but manageable collision ("Kodiak Robotics", "Alloy Therapeutics")
    low      - the name is distinctive ("ZutaCore", "Morphisec")
- "contextTerms" are words that co-occur with genuine coverage of this company. Prefer
  its industry and product category over generic words like "startup" or "company".
- "negativeKeywords" are the things a naive search would wrongly return. Be specific:
  "Honda motorcycle" is useful, "other" is not.
- Keep every list to at most 5 entries, ordered most useful first.
```

## User

```
Company name: {{NAME}}

Return JSON matching this shape:
{
  "known": boolean,
  "sector": string,
  "aliases": string[],
  "domain": string | null,
  "ambiguity": "critical" | "high" | "medium" | "low",
  "contextTerms": string[],
  "negativeKeywords": string[]
}
```

## Output schema

Enforced by Ollama's `format` parameter and re-validated with the same zod schema in
`packages/registry/src/schema.ts`. The model is constrained, not merely asked.

## Notes

- `temperature: 0`, fixed `seed`, `num_ctx: 1024`, `num_predict: 96` (AD-08, AD-18).
- Results are cached by `sha256(model | promptVersion | name)`, so a re-run is free and
  a prompt change automatically invalidates every cached record.
- **The model's output is advisory.** For the 57 names triaged as `critical` or `high`,
  the human-approved query in `packages/registry/data/query-triage.json` wins. The
  enrichment fills in the other fields and covers any company list the reviewers might
  substitute for ours.

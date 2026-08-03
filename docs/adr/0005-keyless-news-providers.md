# ADR-0005 — Keyless news providers behind one interface

**Status:** Accepted · **Date:** 2026-07-31 · **Supersedes:** none

## Context

The brief requires collecting press coverage for 258 companies and says nothing about which
source to use. The obvious candidates — NewsAPI, GNews, NewsData, Event Registry — are better
products than what we chose. They also all require an account, and their free tiers cap at
100–200 requests per day, which cannot cover 258 companies in a single run.

## Decision

Two keyless providers behind one `NewsProvider` interface: **GDELT DOC 2.0** for the rolling
90-day window and **Google News RSS** for the daily delta, plus a `FixtureProvider` for offline
work.

## Rationale

The deciding argument is not data quality, it is whether the reviewer can run this.

A take-home that requires signing up for an API key is a take-home that a meaningful fraction of
reviewers will not execute. Every measurement in this repository — the bake-off, the coverage
baseline, the spot-check — is reproducible by someone who clones it, and that property is worth
more than a better recall figure that nobody can verify.

The interface matters more than either implementation. It is what allowed the whole pipeline to
keep working when GDELT started returning HTTP 429 on 2026-08-02, and what makes a paid provider
an opt-in addition rather than a rewrite.

## Consequences

- **Accepted:** narrower coverage than a paid API. Roughly half the portfolio shows no coverage
  in the window, and some of that is reach rather than genuine silence.
- **Accepted:** neither provider returns a snippet, so classification runs on a ten-word
  headline. This turned out to be the dominant constraint on accuracy in the entire system, and
  it was not foreseen when this decision was made.
- **Validated:** GDELT became unusable mid-project and the run completed anyway, on the second
  provider, with the failure isolated and recorded.

## Revisited

A paid provider is the first item in the V2 roadmap for reducing the zero-coverage baseline. It
belongs behind the same seam, off by default, so the zero-key property survives.

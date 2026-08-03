# ADR-0023 — `node:sqlite` instead of `better-sqlite3`

**Status:** Accepted · **Date:** 2026-07-31

## Context

The storage layer needs unique constraints, indexed date-range queries and durable watermarks.
SQLite is the obvious fit. `better-sqlite3` is the usual choice and has a better API.

It is also a native addon. The risk was written down against task P1.6 *before any code existed*:
"needs build tools on Windows; the documented fallback is `node:sqlite`".

## Decision

Use `node:sqlite`, built into Node 22+, and drop `better-sqlite3`.

## Rationale

The predicted risk fired on the first `npm install`: a `node-gyp` failure on the owner's Windows
machine, for want of Visual Studio C++ Build Tools.

This is the failure mode that matters most for a deliverable that will be run by a stranger. A
project whose install can fail on the reviewer's machine is a project that does not get
evaluated, and no amount of code quality compensates for that.

## Consequences

- **Lost:** `better-sqlite3`'s `db.transaction()` helper, replaced by a SAVEPOINT-based
  `withTransaction` that nests safely — which matters because a repository managing its own
  atomicity may still be called inside a larger transaction.
- **Gained:** zero native compilation, zero build tools, one fewer third-party dependency in the
  most critical layer.
- **Snag worth recording:** Vite derives its Node-builtin list from `module.builtinModules`,
  which omits `sqlite` below Node 24, so it stripped the `node:` prefix and tried to resolve
  `sqlite` from disk. Fixed with a documented test-only shim; application code keeps a plain
  static import.

## What this decision is really about

Naming the likely failure in advance converted an emergency into a checklist item. The risk
register earned its keep here more than anywhere else in the project.

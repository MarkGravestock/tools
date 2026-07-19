# Colophon

Built 18–19 July 2026 with Claude (Anthropic), in the spirit of the
[simonw/tools colophon](https://tools.simonwillison.net/colophon), which
links every tool to the LLM transcripts that produced it.

## Prompt

> Add SQLite Query Explainer tool by simonw · Pull Request #299 ·
> simonw/tools — take a look at this, could you build for postgres?
> Maybe running sample database in container locally?

Followed by: add pgvector support.

## Key decisions

- **PGlite over Docker.** The Pyodide analogue for Postgres is PGlite
  (real Postgres compiled to WASM), which keeps the tool a single HTML
  file. A container would force a backend since browsers can't speak the
  Postgres wire protocol. Trade-off accepted: single-process, so no
  parallel plans, and unrealistic absolute timings.
- **One EXPLAIN ANALYZE run, both views.** Rather than separate
  estimated/actual passes, each node shows planned → actual rows from a
  single `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` execution, with ≥10×
  divergence flagged. Read-only statements also run once plainly for the
  results table; writes run only once, under EXPLAIN ANALYZE.
- **Multi-statement input with `RESET ALL` between runs**, so examples can
  use planner toggles (`enable_hashjoin = off`) to force node types like
  Memoize that never win naturally at this data scale.
- **Testable core.** Annotation logic is a pure module inlined at build
  time; the suite runs all 32 examples against real PGlite and fails on
  any plan node type lacking documentation (27 covered), plus a jsdom
  smoke test drives the built file end to end.

## Bugs met along the way

- `String.replace` mangled the build: inlined source contains `$'`-style
  sequences, which are replacement patterns. Fixed with a function
  replacement.
- Statement splitting kept leading `--` comments, defeating the
  "is this explainable" check.
- The Node smoke harness leaked `global.window`, flipping PGlite into its
  browser codepath and overflowing the stack — a harness bug, not an app
  bug.
- pgvector moved out of the core PGlite package; it now lives in
  `@electric-sql/pglite-pgvector`, peer-pinned to the exact PGlite version.

## Versions at build time

PGlite 0.5.4 (PostgreSQL 18.3) · pglite-pgvector 0.0.5 · fonts: Space
Grotesk + IBM Plex Mono via Google Fonts.

# Postgres Query Explainer

A single-file PostgreSQL query explainer that runs entirely in the browser.
Write a query, get its `EXPLAIN (ANALYZE, BUFFERS)` plan back as an annotated
tree: what each node does in plain English, where the time went, planned vs
actual rows, and amber warnings for mis-estimates, disk spills, lossy bitmaps
and cold visibility maps.

Runs on [PGlite](https://pglite.dev) — real PostgreSQL 18 compiled to WASM —
so the plans are genuine planner output, not a simulation. Includes
[pgvector](https://github.com/pgvector/pgvector) with HNSW examples.

Inspired by [Simon Willison's SQLite Query Explainer](https://tools.simonwillison.net/sqlite-query-explainer)
([simonw/tools#299](https://github.com/simonw/tools/pull/299)).

## Usage

Open `postgres-query-explainer.html` in a browser. First load fetches PGlite
(~4 MB) and two fonts from CDNs; after that it's all local — no server, and
no data leaves the page.

- **Load example database** builds a deterministic web-shop schema
  (~350k rows, plus a partitioned table and a vector table) and offers
  32 example queries grouped by topic — scans, joins, sorting, grouping,
  CTEs, partitions, vector search, and planner pitfalls.
- **Open a .sql file** loads your own schema/data. Plain SQL statements
  only — export with `pg_dump --inserts --no-owner --no-privileges`
  (the default `COPY` format is detected and rejected with a hint).
- Multiple statements are allowed in the editor; the last one is explained,
  and settings are reset between runs — so planner toggles like
  `set enable_hashjoin = off;` work per-query.
- Example-database queries are bookmarkable via `#sql=` URLs.

## Development

```
npm install
npm run build   # inline src/ modules into postgres-query-explainer.html
npm test        # run every example query against PGlite; fail on unknown plan nodes
npm run smoke   # headless end-to-end test of the built file (jsdom + real PGlite)
```

| Path | Purpose |
|---|---|
| `postgres-query-explainer.html` | The tool (built artefact — don't edit directly) |
| `src/template.html` | UI, styles, app wiring |
| `src/planlogic.js` | Pure plan parsing/annotation logic (no DOM) |
| `src/exampledb.js` | Example schema + example queries |
| `src/build.mjs` | Inlines the modules into the template |
| `test/` | Example validation and headless smoke tests |

To add an example query, append to `EXAMPLES` in `src/exampledb.js`, then
`npm test && npm run build`. To annotate a new plan node type, add it to
`NODE_DOCS` in `src/planlogic.js` — the test suite fails on any node type
without documentation.

## Caveats

- PGlite is single-process: no parallel workers (`Gather` nodes), and WASM
  timings are not server timings. Plan *shapes* and estimates are the real
  thing; treat absolute times as indicative only.
- CDN versions are pinned in `src/template.html`; PGlite and the pgvector
  build must stay version-matched when upgrading.

## Further reading

- [Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html) — official docs
- [pgMustard EXPLAIN glossary](https://www.pgmustard.com/docs/explain)
- [PGlite extensions](https://pglite.dev/extensions/)

See `COLOPHON.md` for how this was built.

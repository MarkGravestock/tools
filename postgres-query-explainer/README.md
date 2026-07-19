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
- **Connect to a server** runs your queries against a real PostgreSQL
  instance through a small localhost bridge (see below) — real plans,
  parallel workers, JIT, your production statistics.
- Multiple statements are allowed in the editor; the last one is explained,
  and settings are reset between runs — so planner toggles like
  `set enable_hashjoin = off;` work per-query.
- Example-database queries are bookmarkable via `#sql=` URLs.

## Connecting to a real server

Browsers can't speak the Postgres wire protocol, so live analysis goes
through a tiny HTTP bridge you run on your own machine:

```
cd bridge
npm install
node bridge.mjs --conn "postgres://user:pass@host:5432/db" --name prod
```

It prints a URL and a session token; paste both into **Connect to a server**
on the page. Multiple `--conn ... --name ...` pairs give you a profile picker.

Security model:

- **Credentials never reach the browser.** Connection strings live with the
  bridge process; the page stores only the bridge URL, its token (only if
  "remember token" is ticked), and a profile name.
- **Nothing is ever committed.** Every run — including `EXPLAIN ANALYZE`,
  which really executes the query — happens inside a transaction the bridge
  rolls back.
- **Read-only by default.** Writes fail unless the bridge is started with
  `--allow-writes` (still rolled back; useful for analyzing UPDATE/DELETE
  plans). `--timeout <ms>` caps statement time (default 30s).
- The bridge listens on `127.0.0.1` only and requires its bearer token on
  every request.

Note: `EXPLAIN ANALYZE` executes the query for real on your server — even
rolled back, a heavy query costs real I/O and CPU, and rolled-back writes
still create dead tuples and take locks. Point it at production thoughtfully.

## Development

```
npm install
npm run build   # inline src/ modules into postgres-query-explainer.html
npm test        # example queries against PGlite + bridge end-to-end test
npm run smoke   # headless end-to-end test of the built file (jsdom + real PGlite)
```

The bridge test needs no real server: it exposes PGlite over the actual
Postgres wire protocol (`@electric-sql/pglite-socket`) and runs the real
bridge against it, asserting auth, plans, read-only enforcement, and that
every run is rolled back.

| Path | Purpose |
|---|---|
| `postgres-query-explainer.html` | The tool (built artefact — don't edit directly) |
| `src/template.html` | UI, styles, app wiring |
| `src/planlogic.js` | Pure plan parsing/annotation logic (no DOM) |
| `src/exampledb.js` | Example schema + example queries |
| `src/build.mjs` | Inlines the modules into the template |
| `bridge/` | Localhost HTTP bridge for connecting to real servers |
| `test/` | Example validation, bridge end-to-end, and smoke tests |

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

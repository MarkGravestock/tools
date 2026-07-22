# Calcite Query Explainer

Run SQL against CSV, JSON and Parquet files entirely in the browser, and watch
[Apache Calcite](https://calcite.apache.org/)'s optimizer rewrite the query.
Each run shows two plans side by side: the **logical** relational algebra
straight from your SQL, and the **physical** `Enumerable` plan Calcite actually
compiles and executes. Every operator is annotated in plain English and
colour-coded by kind, a one-line summary calls out what the optimizer changed
(say, a logical `Join` becoming an `EnumerableMergeJoin`), and the **rewrite
rules** it fired to get there are listed with how often each ran.

Runs on real Apache Calcite 1.41 compiled to WebAssembly with
[CheerpJ](https://cheerpj.com/) — genuine planner output, not a reimplementation.
Because it's Calcite rather than a single-format engine, a query can join a CSV
table to a JSON one without anyone caring which is which.

This grew out of the [feasibility spike](../calcite-spike/) that confirmed
Calcite (including its Janino runtime code generation) runs under CheerpJ.

## Usage

**Serve it over HTTP with a Range-capable server** — two gotchas, both fatal if
skipped:

- Opening `calcite-query-explainer.html` directly (`file://`) gives a null
  origin, and the browser blocks the fetches CheerpJ needs.
- `python -m http.server` serves over HTTP but **ignores the `Range` header**,
  and CheerpJ streams the jar with byte-range requests — so it fails with
  *"HTTP server does not support the 'Range' header."*

Use the included server:

```sh
cd calcite-query-explainer
python serve.py            # http://localhost:8000/  (python3 on some systems)
```

Open <http://localhost:8000/>. The first load fetches the CheerpJ runtime from
its CDN plus the ~28 MB engine jar; both are cached afterwards, and nothing you
type leaves the page. GitHub Pages supports Range requests natively, so the
deployed site needs no special server — `serve.py` is only for local runs.

- The page starts with three sample tables (`employees` as CSV, `departments`
  as JSON, `sales` as CSV) and a set of example queries grouped by topic:
  basics, joins, aggregates, optimizer rewrites, and cross-format joins.
- **Add CSV / JSON / Parquet file** registers your own data. A `.csv` file
  becomes a table named after the file with an inferred column type per column;
  a `.json` file must be an array of flat objects; a `.parquet` file is decoded
  in the browser. Drop the included `sample-products.parquet` and run
  `select * from products` to try the Parquet path.
- **Run & explain** (or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Enter</kbd>) runs the
  query and renders the results, both plan stages, and the rules the optimizer
  fired.

## How it works

The engine is a small Java facade (`cqe.QueryRunner`) over Calcite's JDBC
driver, exposed to the page through CheerpJ's library mode. The JS/Java boundary
is strings only: table text in, JSON out.

- CSV and JSON are parsed into in-memory `ScannableTable`s with per-column type
  inference, registered on a Calcite root schema.
- **Parquet** is decoded to plain row objects in the browser with
  [hyparquet](https://github.com/hyparam/hyparquet) (lazily imported from a CDN
  only when a `.parquet` file is added) and handed to the engine as JSON, so the
  Java side stays format-agnostic. The file's bytes never leave the page — only
  the decoder's code is fetched.
- `run(sql)` executes through the normal JDBC path (which is where Calcite
  generates and Janino-compiles the query).
- `explain(sql)` returns both stages from JDBC `EXPLAIN`:
  `EXPLAIN PLAN WITHOUT IMPLEMENTATION FOR …` for the logical algebra, and the
  default `EXPLAIN PLAN FOR …` for the optimized physical plan.
- `rules(sql)` reports the optimizer rules that actually fired. Rather than
  rebuild a planner, it attaches a `RelOptListener` to the very planner the JDBC
  path uses (via Calcite's `Hook.PLANNER`) and triggers planning, so the rule
  list matches the physical plan exactly.
- The page parses the indented plan text into a tree and annotates each
  operator. The parser and the annotation table are a pure module
  (`src/planlogic.js`), inlined into the page at build time and unit-tested
  directly — the same pattern as the Postgres Query Explainer's `planlogic.js`.

## Layout

```
calcite-query-explainer.html   built single page (committed; open via serve.py)
app/calcite-query-explainer.jar the Calcite engine jar, served to the browser
sample-products.parquet         a small snappy-compressed Parquet file to try
serve.py                        Range-capable static server for local runs
src/
  template.html                 page shell with //@@INLINE markers + theme
  planlogic.js                  plan parsing + operator annotation (pure, tested)
  examples.js                   sample datasets and example queries (pure)
  build.mjs                     inlines the modules → ../calcite-query-explainer.html
java/                           Gradle project that builds the engine jar
  src/main/java/cqe/            QueryRunner, table builders, JSON encoding, Repl
test/
  plan.test.mjs                 unit tests for the plan module
  engine.test.mjs               every example query against the real jar (needs a JDK)
  ui.smoke.mjs                  the built page's UI under a DOM shim (CheerpJ stubbed)
```

## Building

The jar is built with Gradle and lands straight in `app/`:

```sh
npm run build:jar     # gradle -p java shadowJar  → app/calcite-query-explainer.jar
npm run build         # inline the JS modules → calcite-query-explainer.html
```

Tests:

```sh
npm test              # pure plan-module unit tests (no JDK needed)
npm run smoke         # every example query through the real jar (needs a JDK + built jar)
npm run smoke:ui      # drives the built page under a DOM shim (no browser, no CheerpJ)
```

## Notes and limits

- Data lives entirely in memory and is re-scanned per query — this is for
  understanding plans on sample-sized data, not for large files.
- CSV parsing is deliberately simple (no quoted commas); paste structured data
  as JSON if you need it.
- Parquet decoding needs one-time network access to fetch the hyparquet decoder
  from a CDN; the Parquet data itself is decoded locally and never uploaded. CSV
  and JSON work fully offline.
- The tool leans on Calcite *because* it's Calcite — the plan pipeline is the
  point. For raw "SQL over files in the browser" with big data,
  [DuckDB-WASM](https://shell.duckdb.org) is the better fit.
- Unlike the sibling Postgres tool, this can't be a single self-contained HTML
  file: CheerpJ loads the engine as a separate jar, so the jar sits beside the
  page and the CheerpJ runtime streams from its CDN on first load.

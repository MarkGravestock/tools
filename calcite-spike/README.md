# Calcite-in-browser feasibility spike

Can [Apache Calcite](https://calcite.apache.org/) — a Java library — run SQL
queries entirely in the browser? This spike says **yes, pending one final
in-browser confirmation**: real, unmodified Calcite 1.41 jars on the
[CheerpJ](https://cheerpj.com/) WebAssembly JVM, queried from JavaScript via
CheerpJ's library mode.

## How to run it

**It must be served over HTTP** — opening `index.html` directly (`file://`)
gives a null origin and Chrome blocks every fetch CheerpJ needs, so nothing
loads. Serve the **repo root** (the page loads
`calcite-spike/app/calcite-spike.jar` relative to the site root, same as
GitHub Pages will):

```sh
python3 -m http.server 8000   # from the repo root (use `python` on Windows)
```

Open <http://localhost:8000/calcite-spike/>. The page needs internet access
for the CheerpJ runtime (`cjrtnc.leaningtech.com`). It self-tests and shows a
green/red verdict:

1. initialise CheerpJ,
2. load the Calcite fat jar,
3. register two CSV-backed tables,
4. `SELECT 1` (parse → plan → **Janino codegen** → execute),
5. join + aggregate across the two tables,
6. `EXPLAIN` showing the physical Enumerable plan.

Then there's a free-form SQL box against `EMP`/`DEPT`.

## What's verified so far

- **On a local JVM (Java 8 semantics): everything.** `gradle run` in `java/`
  executes the exact same calls the page makes — including the join, which
  Calcite executes by generating Java source at runtime and compiling it with
  Janino. `SPIKE OK` on JDK 21 with `--release 8` bytecode.
- **The fat jar is 100% Java 8 bytecode** (scanned all ~16k classes; nothing
  above class-file major 52 outside `META-INF/versions/`), matching CheerpJ's
  most mature runtime.
- **Not yet verified: the same checks inside CheerpJ.** The dev container
  that produced this spike has a network policy that blocks CheerpJ's CDN, so
  the in-browser run needs a normal machine: serve the repo, open the page,
  read the verdict banner. That is the last open question, and the page
  answers it by itself.

## Findings / gotchas

- **`ONE` is a Calcite parser keyword** (`ONE ROW PER MATCH`), so
  `select 1 as one` fails to parse. Sample queries avoid it.
- The planner picked `EnumerableMergeJoin` over hash join for the sample —
  either proves the codegen path.
- The JS↔Java boundary is strings only (CSV in, JSON out) — CheerpJ library
  mode handles that with zero friction.
- Jar is ~28 MB after `shadowJar` minimisation. Calcite core drags in
  optional function libraries (JTS geometry, datasketches, jsonpath, yaml);
  a real tool could likely trim several MB more, and should build the jar in
  CI rather than committing it (it's committed here so GitHub Pages can serve
  the spike as-is).
- CheerpJ's free tier covers personal/FOSS use served from their CDN —
  re-check licensing before productising.

## Layout

```
index.html              self-testing spike page (CheerpJ + free-form SQL box)
app/calcite-spike.jar   built fat jar, served to the browser
java/                   Gradle project that builds it
  src/main/java/spike/
    QueryRunner.java    static String-in/JSON-out facade called from JS
    CsvTable.java       in-memory ScannableTable with naive CSV parsing + type inference
    SpikeMain.java      local JVM smoke test (gradle run)
```

Rebuild with `gradle shadowJar` in `java/`, then copy
`java/build/libs/calcite-spike.jar` to `app/`.

## If the in-browser run is green, the real tool gets

- SQL → logical plan → optimised plan visualisation (rules firing, plan
  before/after) — the thing DuckDB-WASM can't show you;
- joins across heterogeneous formats: CSV/JSON via this table shim, Parquet
  decoded JS-side (e.g. hyparquet) and registered the same way;
- drag-and-drop files, sample datasets, shared site theme.

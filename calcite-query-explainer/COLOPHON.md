# Colophon

Built 22 July 2026 with Claude (Anthropic), in the spirit of the
[simonw/tools colophon](https://tools.simonwillison.net/colophon). Follows the
sibling [Postgres Query Explainer](../postgres-query-explainer/), and picks up
where the [Calcite feasibility spike](../calcite-spike/) left off.

## Prompt

> i'd like to build another htm/wasm tool that runs calcite queries against
> file formats in the browser with sample files. how feasible is this?

After a spike proved it out end to end (including in a real browser):

> let's do it. try and make it align with the other tool project where possible.

## Key decisions

- **CheerpJ over a reimplementation.** Calcite is a Java library with no WASM
  build, so the honest way to run "real Calcite" in the browser is a JVM in
  WebAssembly. The spike confirmed the one genuine risk — Calcite generating
  and Janino-compiling query code at runtime — works under CheerpJ.
- **The plan pipeline is the product.** DuckDB-WASM already does SQL over files
  in the browser. What Calcite offers that nothing else does client-side is a
  visible optimizer: the tool shows the logical algebra and the physical plan
  from a single query, and names what changed between them.
- **Both plan stages come from JDBC `EXPLAIN`, not the Frameworks API.**
  `EXPLAIN PLAN WITHOUT IMPLEMENTATION FOR` gives the logical relational
  algebra; the default `EXPLAIN PLAN FOR` gives the optimized physical plan.
  Staying on the JDBC path (already proven under CheerpJ in the spike) avoided
  a riskier planner-driver rewrite.
- **Cross-format joins fall out for free.** CSV and JSON both parse into the
  same in-memory `ScannableTable`, so a CSV table joins a JSON table with no
  special handling — the clearest demonstration of why it's Calcite.
- **Testable core, mirroring the sibling.** The plan parser and operator
  annotations are a pure module inlined at build time. Three suites guard it:
  unit tests on the parser, an engine suite that runs every example query
  against the real jar and fails on any undocumented plan operator (the analogue
  of the Postgres tool running all its examples against live PGlite), and a
  DOM-shim smoke test that drives the built page with CheerpJ stubbed.

## Follow-up: rules fired, and Parquet

Added after the first version merged, in response to "do it" on the two
suggested extensions.

- **Real fired rules, not a heuristic.** The obvious way to name the optimizer
  rules would be to guess them from the operator diff. Instead, `rules(sql)`
  attaches a `RelOptListener` to the actual planner through Calcite's
  `Hook.PLANNER` and triggers planning, so the list is exactly what fired —
  `EnumerableMergeJoinRule`, `SortRemoveRule`, `AggregateReduceFunctionsRule`,
  and so on, with counts. Reuses the proven JDBC path rather than a hand-built
  Frameworks rule set, which would have been version-fragile.
- **Parquet decoded in JS, not Java.** The Java Parquet reader drags in
  parquet-mr and Hadoop, which is exactly what the browser doesn't want.
  hyparquet decodes Parquet (including snappy) to plain row objects in the page,
  which are handed to the engine as JSON — so the Java side never learns a third
  format. hyparquet is imported lazily from a CDN only when a `.parquet` file is
  added; consistent with the CheerpJ runtime already streaming from a CDN, and
  it keeps the base page small. The file's bytes stay in the page.

## Bugs met along the way

- **`file://` and the `Range` header.** CheerpJ needs an HTTP server that
  answers byte-range requests with `206 Partial Content`; `python -m
  http.server` does not. Carried over the spike's `serve.py` and documented
  both traps up front.
- **`ONE` is a reserved word.** Calcite's parser treats `ONE` as a keyword
  (`ONE ROW PER MATCH`), so `select 1 as one` fails — example queries avoid it.
- **Scalar subqueries break naïve plan parsing.** The logical plan inlines a
  scalar subquery as a multi-line `$SCALAR_QUERY({ …nested plan… })` block
  inside the parent node's text, which a one-operator-per-line parser reads as
  bogus sibling operators. Fixed by folding lines into the current node's detail
  until brackets balance, with a regression test.
- **`Buffer.buffer` isn't the file.** Decoding the sample Parquet in Node failed
  with `footer != PAR1` because a Node `Buffer` is a view into a shared pool, so
  `.buffer` hands back far more than the file's bytes. Sliced with
  `byteOffset`/`byteLength`. The browser's `File.arrayBuffer()` is exact, so this
  was only a test-harness trap, but a confusing one.

## Versions at build time

Apache Calcite 1.41.0 (Java 8 bytecode) · CheerpJ 4.3 runtime · hyparquet 1.26.2
+ hyparquet-compressors 1.1.1 (Parquet decode, via esm.sh) · built with Gradle +
the Shadow plugin on JDK 21 targeting `--release 8` · fonts: Space Grotesk + IBM
Plex Mono via Google Fonts.

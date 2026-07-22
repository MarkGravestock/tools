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

## Versions at build time

Apache Calcite 1.41.0 (Java 8 bytecode) · CheerpJ 4.3 runtime · built with
Gradle + the Shadow plugin on JDK 21 targeting `--release 8` · fonts: Space
Grotesk + IBM Plex Mono via Google Fonts.

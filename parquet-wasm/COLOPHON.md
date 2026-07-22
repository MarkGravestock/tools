# Colophon

Brought into this repo 22 July 2026 with Claude (Anthropic), re-skinned to match
the site. The Java, the build, and the hard-won wasm-backend knowledge come from
the `graalvm-wasm-parquet` experiment in `MarkGravestock/claude-playground`; this
tool wraps it in the shared theme and sits it beside the CheerpJ-based Calcite
Query Explainer as the other half of a "Java in the browser, two ways" pairing.

## Prompt

> theres a similar project in experiments for parquet. make sense to bring it in
> as a separate tool in this project. align the approach with these tools and
> presentation

Then, on making it interactive:

> can we add interactivity but by using the cheerpj model instead. i guess
> graalvm means that we need a java compile phase which limits being able to deal
> with arbitrary files??

## Key decisions

- **Re-skin first, interactivity second.** The experiment auto-runs a Java `main`
  that reads an embedded sample and prints to stdout. The tool first brought that
  in as-is under the shared theme (fonts, colours, theme toggle, the `pqe-theme`
  key); a follow-up then made it interactive (see below), so the page now renders
  schema/metadata/rows for a file you drop rather than mirroring stdout.
- **Prebuilt artifacts committed.** Like the Calcite tool's jar, the
  `parquet-wasm.js` launcher and `parquet-wasm.js.wasm` are committed so GitHub
  Pages serves the tool as-is. Regenerating them needs the GraalVM toolchain,
  which the scripts under `java/` fetch.
- **Flat layout.** The GraalVM launcher resolves the `.wasm` relative to its own
  script URL (`document.currentScript`), so the page and the two artifacts share
  a directory rather than using an `app/` subfolder.
- **Positioned as the CheerpJ tool's sibling.** The README spells out the
  contrast: CheerpJ ships bytecode to a JVM-in-wasm and interprets it; GraalVM
  compiles the Java to wasm ahead of time, so the program *is* the module.

## Made interactive (follow-up)

The first cut read a fixed embedded sample. When the question came up of adding
"drop your own Parquet" — and specifically whether to switch to the CheerpJ
model to do it — the honest answer was that CheerpJ is the friendlier
interactivity model (library mode passes data in and out trivially, like the
Calcite tool), **but Hardwood is compiled to Java 21 bytecode and CheerpJ 4.3
tops out at Java 17**, so its jar can't load under CheerpJ today. Staying on
GraalVM and adding interactivity via its JS↔wasm interop turned out to be the
tractable path.

The interop, once spiked, is small:

- `demo.InteractiveInspector` exports a Java function to JS with the wasm
  backend's `@JS` annotation: a `native` method whose body is
  `globalThis.parquetInspect = inspect;`, handed a `Function<JSString,JSString>`
  in `main`.
- Built with `-H:-AutoRunVM` (needs `-H:+UnlockExperimentalVMOptions`), so `main`
  registers the function when the page calls `GraalVM.run([])` instead of running
  on load. The launcher already exposes `globalThis.GraalVM`.
- The file crosses the boundary as base64 (a plain string), so no typed-array
  marshalling — the page decodes nothing, Java base64-decodes to bytes, Hardwood
  reads, JSON comes back.

De-risked in three steps before wiring the UI: a minimal `echo` export compiled
and round-tripped under Node; the Parquet→JSON logic verified on a stock JVM; then
the full `parquetInspect(base64)` path verified end to end under Node
(`--experimental-wasm-exnref`) against the sample.

## Notes carried over from the experiment

- The wasm backend is single-threaded and refuses code that reaches
  `java.lang.VirtualThread`, so Hardwood's parallel `RowReader` can't compile;
  a synchronous reader built on its internal `RowGroupIterator → PageSource →
  PageDecoder` path is used instead.
- `native-image --tool:svm-wasm` must be the first argument, and it needs
  Binaryen's `wasm-as` on the PATH (the npm `binaryen` package works).
- The sample file is embedded as a classpath resource, since the wasm target has
  no filesystem, and `java.util.logging`'s console handler is reset because it
  dies in `StackWalker.walk` on wasm.

## Build met along the way

- **`npm install --prefix ./binaryen` needs the directory seeded.** The
  toolchain script's Binaryen install failed with `ENOENT` on a missing
  `package.json`; running `npm init -y` in the target dir first fixes it. (Filed
  as a papercut; the committed artifacts were built after the fix.)

## Versions at build time

Oracle GraalVM 25 (`native-image` svm-wasm backend) · Binaryen 131 · Hardwood
`hardwood-core` 1.0.0.Final · built on JDK 21 (Gradle) → wasm · verified under
Node 22 with `--experimental-wasm-exnref`. Launcher ~90 KB, module ~8.5 MB.
Fonts: Space Grotesk + IBM Plex Mono via Google Fonts.

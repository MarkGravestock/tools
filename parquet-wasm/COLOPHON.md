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

## Key decisions

- **Faithful re-skin, not a rewrite.** The experiment auto-runs a Java `main`
  that reads an embedded sample and prints to stdout; the GraalVM launcher
  mirrors that through `console.log`. The tool keeps exactly that and restyles
  the page (shared fonts, colours, theme toggle, the `pqe-theme` key), so the
  behaviour is unchanged and the presentation matches the rest of the site.
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

## Why it stayed a fixed-sample demo

Making it an interactive "drop your own Parquet" tool (to truly match the
Calcite tool's file-drop model) needs GraalVM's experimental JS↔wasm interop:
exporting a Java function callable from JavaScript and marshalling the file's
bytes in and structured results out. That's a research task with ~1.5-minute
build cycles and real risk of not landing, so it's noted as a follow-up rather
than forced. The value here is the toolchain demonstration — the same Java
producing identical output on the JVM, Node, and the browser.

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

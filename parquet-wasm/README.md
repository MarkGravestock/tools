# Parquet in WebAssembly

A Java program reads an Apache Parquet file in the browser — the
[Hardwood](https://github.com/hardwood-hq/hardwood) parser decoding
`alltypes_plain.parquet` from
[apache/parquet-testing](https://github.com/apache/parquet-testing) — compiled
to WebAssembly by [GraalVM Native Image](https://www.graalvm.org/latest/reference-manual/web-image/)'s
experimental wasm backend. Schema, metadata, and all eight rows come out
identical on the JVM, under Node.js, and in the browser.

It's the GraalVM counterpart to this repo's
[Calcite Query Explainer](../calcite-query-explainer/), which reaches Java in the
browser through CheerpJ instead. Same goal, two very different routes:

| | Calcite Query Explainer | Parquet in WebAssembly |
|---|---|---|
| Route to the browser | CheerpJ (a JVM in WebAssembly) | GraalVM Native Image (Java → wasm, ahead of time) |
| What ships | Java bytecode jar + CheerpJ runtime (CDN) | a single self-contained `.wasm` module |
| Runtime model | interprets/JITs your bytecode | your code *is* the wasm |
| Payload | ~28 MB jar, streamed and cached | ~8.5 MB `.wasm`, one file |

This tool was brought in from the `graalvm-wasm-parquet` experiment in
`MarkGravestock/claude-playground` and re-skinned to match the site.

## Usage

Serve the folder over HTTP (wasm can't load from a `file://` page) — any static
server works, no Range support needed:

```sh
cd parquet-wasm
python3 -m http.server 8000
```

Open <http://localhost:8000/>. The page loads `parquet-wasm.js` (the GraalVM
launcher), which fetches `parquet-wasm.js.wasm` and runs the Java `main`
automatically, mirroring its `System.out` into the page.

Needs a browser with **WasmGC** and **exception handling (exnref)** — recent
Chrome or Firefox, no flags. Nothing leaves the page; the Parquet file is
embedded in the wasm module.

## How it works

The Parquet file is baked into the wasm as a classpath resource (the wasm target
has no filesystem). The demo reads it with a single-threaded reader, because the
wasm backend can't compile Hardwood's virtual-thread pipeline — see the colophon
for that and the other footnotes hit along the way.

- `demo.WasmDemo` is the wasm entry point (single-threaded `SyncParquetReader`).
- `demo.JvmDemo` uses Hardwood's threaded `RowReader`, the normal way, on a JVM.
- `demo.ParquetDemo` is the shared logic that prints metadata, schema, and rows.

## Building the wasm

The committed `parquet-wasm.js` + `parquet-wasm.js.wasm` are prebuilt. To
regenerate them you need Oracle GraalVM 25 (for `native-image --tool:svm-wasm`)
and Binaryen; the scripts under `java/` fetch both:

```sh
cd java
./setup-toolchain.sh     # downloads Oracle GraalVM 25 (~350 MB) + Binaryen (npm)
./build-wasm.sh          # gradle wasmPrep + native-image  (~1.5 min)
                         # copies the artifacts up to the tool root
```

Run the same Java on a JVM (any Java 21+, Gradle 8+) to compare:

```sh
cd java
gradle runJvm    # Hardwood's threaded RowReader
gradle runSync   # the wasm-compatible single-threaded reader, on the JVM
```

Or run the built wasm under Node 22+ (the `--experimental-wasm-exnref` flag is
needed before Node 25):

```sh
node --experimental-wasm-exnref parquet-wasm.js
```

## Layout

```
index.html               themed page; loads parquet-wasm.js and mirrors its stdout
parquet-wasm.js          GraalVM launcher (~90 KB, committed)
parquet-wasm.js.wasm     the compiled module (~8.5 MB, committed)
java/                    rebuildable source + build scripts
  build.gradle.kts, settings.gradle.kts
  build-wasm.sh, setup-toolchain.sh
  src/main/java/demo/    WasmDemo, JvmDemo, ParquetDemo, SyncParquetReader, ValueFormatter
  src/main/resources/    the embedded sample parquet + native-image resource-config
```

## Credits and licensing

- `alltypes_plain.parquet` is copied unmodified from
  [apache/parquet-testing](https://github.com/apache/parquet-testing)
  (Apache License 2.0): 8 rows, 11 columns spanning INT32/INT64/BOOLEAN/FLOAT/
  DOUBLE/BYTE_ARRAY/INT96, written by Impala 1.3 — old enough to exercise
  unannotated binary strings and legacy INT96 timestamps.
- Parquet reading by [Hardwood](https://github.com/hardwood-hq/hardwood).

## Limits

- Reads the one embedded sample file; it isn't yet an interactive "drop your own
  Parquet" tool. That would need GraalVM's experimental JS↔wasm interop to pass
  file bytes into the module and hand structured output back — a reasonable
  follow-up, but a research task with slow build cycles.
- The wasm backend is single-threaded and experimental; this is a demonstration
  of the toolchain, not a production Parquet reader.

# Parquet in WebAssembly

Drop an Apache Parquet file and read its schema, metadata, and rows entirely in
the browser — the [Hardwood](https://github.com/hardwood-hq/hardwood) parser,
Java, compiled to WebAssembly by
[GraalVM Native Image](https://www.graalvm.org/latest/reference-manual/web-image/)'s
experimental wasm backend and called from JavaScript through the backend's `@JS`
interop. The same Java produces the same result on a JVM, under Node.js, and in
the browser.

It's the GraalVM counterpart to this repo's
[Calcite Query Explainer](../calcite-query-explainer/), which reaches Java in the
browser through CheerpJ instead. Same goal, two very different routes:

| | Calcite Query Explainer | Parquet in WebAssembly |
|---|---|---|
| Route to the browser | CheerpJ (a JVM in WebAssembly) | GraalVM Native Image (Java → wasm, ahead of time) |
| What ships | Java bytecode jar + CheerpJ runtime (CDN) | a single self-contained `.wasm` module |
| Runtime model | interprets/JITs your bytecode | your code *is* the wasm |
| JS ↔ Java | CheerpJ library mode (`await lib.pkg.Class.method`) | `@JS`-exported function on `globalThis` |
| Payload | ~28 MB jar, streamed and cached | ~8.5 MB `.wasm`, one file |

This grew out of the `graalvm-wasm-parquet` experiment in
`MarkGravestock/claude-playground`, re-skinned to match the site and made
interactive.

## Usage

Serve the folder over HTTP (wasm can't load from a `file://` page) — any static
server works, no Range support needed:

```sh
cd parquet-wasm
python3 -m http.server 8000
```

Open <http://localhost:8000/>, then choose or drop a `.parquet` file. The page
loads the bundled `sample-alltypes.parquet` on start so there's something to see.

Needs a browser with **WasmGC** and **exception handling (exnref)** — recent
Chrome or Firefox, no flags. Your file's bytes never leave the page.

## How it works

The interactive entry point, `demo.InteractiveInspector`, doesn't read a fixed
file — it exports a Java function to JavaScript and lets the page feed it bytes:

```java
@JS(args = {"inspect"}, value = "globalThis.parquetInspect = inspect;")
private static native void register(Function<JSString, JSString> inspect);

public static void main(String[] args) {
    register(base64 -> JSString.of(inspect(base64.asString())));
}
```

Built with `-H:-AutoRunVM`, so `main` (which publishes `globalThis.parquetInspect`)
runs when the page calls `GraalVM.run([])` rather than on load. The page then
base64-encodes the dropped file, calls `parquetInspect`, and renders the JSON
that comes back — schema, metadata, and rows. Base64 keeps the JS↔wasm boundary
a plain string, so no typed-array marshalling is involved.

- `demo.ParquetInspector` is the shared reader: Hardwood metadata + a
  single-threaded `SyncParquetReader` (the wasm backend can't compile Hardwood's
  virtual-thread `RowReader`), rendered to JSON.
- `demo.InteractiveInspector` is the wasm entry that exports it to JS.
- `demo.JvmDemo` / `demo.WasmDemo` are the original fixed-sample demos, kept for
  running the same code straight on a JVM.

## Building the wasm

The committed `parquet-wasm.js` + `parquet-wasm.js.wasm` are prebuilt. To
regenerate them you need Oracle GraalVM 25 (for `native-image --tool:svm-wasm`)
and Binaryen; the scripts under `java/` fetch both:

```sh
cd java
./setup-toolchain.sh     # downloads Oracle GraalVM 25 (~350 MB) + Binaryen (npm)
./build-wasm.sh          # compiles with GraalVM's javac + native-image (~1.5 min)
                         # copies the artifacts up to the tool root
```

`InteractiveInspector` uses `org.graalvm.webimage.api` (`@JS`), which only exists
in the GraalVM JDK, so `build-wasm.sh` compiles the demo package with GraalVM's
`javac`; Gradle excludes that one class so the JVM demos still build on a stock
JDK:

```sh
cd java
gradle runJvm    # Hardwood's threaded RowReader, fixed sample, on a JVM
gradle runSync   # the wasm-compatible single-threaded reader, on a JVM
```

## Layout

```
index.html               themed page; drives GraalVM.run() + globalThis.parquetInspect
parquet-wasm.js          GraalVM launcher (~90 KB, committed)
parquet-wasm.js.wasm     the compiled module (~8.5 MB, committed)
sample-alltypes.parquet  bundled sample, loaded on start
java/                    rebuildable source + build scripts
  build.gradle.kts, settings.gradle.kts
  build-wasm.sh, setup-toolchain.sh
  src/main/java/demo/    InteractiveInspector, ParquetInspector, SyncParquetReader,
                         ValueFormatter, WasmDemo, JvmDemo, ParquetDemo
  src/main/resources/    the fixed-sample parquet + native-image resource-config
```

## Credits and licensing

- `sample-alltypes.parquet` is copied unmodified from
  [apache/parquet-testing](https://github.com/apache/parquet-testing)
  (Apache License 2.0): 8 rows, 11 columns spanning INT32/INT64/BOOLEAN/FLOAT/
  DOUBLE/BYTE_ARRAY/INT96, written by Impala 1.3 — old enough to exercise
  unannotated binary strings and legacy INT96 timestamps.
- Parquet reading by [Hardwood](https://github.com/hardwood-hq/hardwood).

## Limits

- The reader is single-threaded and the wasm backend is experimental; this is a
  demonstration of the toolchain, not a production Parquet reader. Very large
  files are read fully into memory and base64'd across the boundary.
- Hardwood is compiled to Java 21 bytecode, so the CheerpJ route (which tops out
  at Java 17 today) can't run it unmodified — GraalVM's ahead-of-time compile is
  what makes this Java-in-the-browser Parquet reader possible right now.

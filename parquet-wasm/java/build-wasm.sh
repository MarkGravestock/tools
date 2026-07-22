#!/usr/bin/env bash
# Compiles the demo to WebAssembly with GraalVM Native Image's experimental
# wasm backend. Run ./setup-toolchain.sh once first (or point GRAALVM_HOME at
# Oracle GraalVM 25+ and put Binaryen's wasm-as on the PATH).
# Requires Gradle 8+ on the PATH.
set -euo pipefail
cd "$(dirname "$0")"

GRAALVM_HOME="${GRAALVM_HOME:-$PWD/toolchain/graalvm}"
BINARYEN_BIN="$PWD/toolchain/binaryen/node_modules/.bin"
[ -x "$GRAALVM_HOME/bin/native-image" ] || { echo "native-image not found — run ./setup-toolchain.sh"; exit 1; }
export PATH="$GRAALVM_HOME/bin:$BINARYEN_BIN:$PATH"

gradle -q wasmPrep

CLASSPATH="build/classes/java/main:build/resources/main:$(ls build/dependency/*.jar | tr '\n' ':')"

# --tool:svm-wasm must come first; it switches native-image to the wasm backend.
native-image --tool:svm-wasm -o build/parquet-wasm -cp "$CLASSPATH" demo.WasmDemo

# Publish the launcher + wasm next to the page (the tool root, one dir up),
# which is what GitHub Pages serves. The launcher resolves the .wasm relative to
# itself, so page and artifacts must share a directory.
cp build/parquet-wasm.js build/parquet-wasm.js.wasm ../

echo
echo "Build done. Artifacts copied to the tool root. Try it locally with:"
echo "  cd .. && python3 -m http.server 8000   # then open http://localhost:8000/"

#!/usr/bin/env bash
# Compiles the interactive inspector to WebAssembly with GraalVM Native Image's
# experimental wasm backend. Run ./setup-toolchain.sh once first (or point
# GRAALVM_HOME at Oracle GraalVM 25+ and put Binaryen's wasm-as on the PATH).
# Requires Gradle 8+ on the PATH.
set -euo pipefail
cd "$(dirname "$0")"

GRAALVM_HOME="${GRAALVM_HOME:-$PWD/toolchain/graalvm}"
BINARYEN_BIN="$PWD/toolchain/binaryen/node_modules/.bin"
[ -x "$GRAALVM_HOME/bin/native-image" ] || { echo "native-image not found — run ./setup-toolchain.sh"; exit 1; }
export PATH="$GRAALVM_HOME/bin:$BINARYEN_BIN:$PATH"

# Gradle only resolves the Hardwood dependency into build/dependency/.
gradle -q copyDeps

# InteractiveInspector uses org.graalvm.webimage.api (@JS), which lives only in
# the GraalVM JDK, so compile the whole demo package with GraalVM's javac
# (Gradle excludes that one class). This overwrites Gradle's class output.
DEPS="$(ls build/dependency/*.jar | tr '\n' ':')"
rm -rf build/wasm-classes && mkdir -p build/wasm-classes
"$GRAALVM_HOME/bin/javac" --add-modules org.graalvm.webimage.api \
    -cp "$DEPS" -d build/wasm-classes \
    $(find src/main/java -name '*.java')
cp -r src/main/resources/. build/wasm-classes/ 2>/dev/null || true

CLASSPATH="build/wasm-classes:$DEPS"

# --tool:svm-wasm must come first; it switches native-image to the wasm backend.
# -H:-AutoRunVM makes main() (which publishes globalThis.parquetInspect) run when
# JavaScript calls GraalVM.run([]), rather than on module load.
native-image --tool:svm-wasm -H:+UnlockExperimentalVMOptions -H:-AutoRunVM \
    -o build/parquet-wasm -cp "$CLASSPATH" demo.InteractiveInspector

# Publish the launcher + wasm next to the page (the tool root, one dir up),
# which is what GitHub Pages serves. The launcher resolves the .wasm relative to
# itself, so page and artifacts must share a directory.
cp build/parquet-wasm.js build/parquet-wasm.js.wasm ../

echo
echo "Build done. Artifacts copied to the tool root. Try it locally with:"
echo "  cd .. && python3 -m http.server 8000   # then open http://localhost:8000/"

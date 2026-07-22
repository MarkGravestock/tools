#!/usr/bin/env bash
# Downloads the toolchain needed for the wasm build into ./toolchain/:
#   - Oracle GraalVM 25 (native-image with the experimental svm-wasm backend)
#   - Binaryen (wasm-as etc.) via npm, as used by the wasm backend
# Requires: curl, tar, npm. Idempotent — skips anything already present.
set -euo pipefail
cd "$(dirname "$0")"

mkdir -p toolchain
cd toolchain

if [ ! -d graalvm ]; then
  echo "Downloading Oracle GraalVM 25 (~350 MB)..."
  curl -sSL -o graalvm.tar.gz https://download.oracle.com/graalvm/25/latest/graalvm-jdk-25_linux-x64_bin.tar.gz
  tar xzf graalvm.tar.gz
  rm graalvm.tar.gz
  mv graalvm-jdk-25* graalvm
fi

if [ ! -x binaryen/node_modules/.bin/wasm-as ]; then
  echo "Installing Binaryen via npm..."
  npm install --prefix ./binaryen binaryen >/dev/null
fi

echo "Toolchain ready:"
./graalvm/bin/java -version 2>&1 | grep -v "Picked up" | head -1
./binaryen/node_modules/.bin/wasm-as --version

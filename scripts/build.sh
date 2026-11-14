#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
GOOS=js GOARCH=wasm go build -trimpath -ldflags='-s -w' -o dist/core.wasm ./cmd/wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" dist/wasm_exec.js
python3 scripts/standalone.py

#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mkdir -p public
GOOS=js GOARCH=wasm go build -trimpath -ldflags='-s -w' -o public/core.wasm ./cmd/wasm
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" public/wasm_exec.js

npx vite build --config vite.worker.config.ts

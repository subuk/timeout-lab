#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
go run ./cmd/schema
node scripts/check-schema.mjs
python3 scripts/generate-types.py
npm run typecheck
sh scripts/build-wasm.sh
npx vite build
python3 scripts/standalone.py

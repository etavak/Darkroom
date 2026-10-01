#!/usr/bin/env bash
# Linux / generic Unix launcher (also works on macOS).
set -euo pipefail
cd "$(dirname "$0")"

NODE_URL="https://nodejs.org/"

if ! command -v node >/dev/null 2>&1; then
  echo "[Darkroom] Node.js was not found on PATH."
  echo "Install Node.js 22 or newer from:"
  echo "  $NODE_URL"
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "[Darkroom] Node.js 22+ is required. Found: $(node -v)"
  echo "Download Node.js 22 LTS from:"
  echo "  $NODE_URL"
  exit 1
fi

if [ ! -d node_modules/@clack/prompts ]; then
  echo "[Darkroom] Installing dependencies…"
  npm install
fi

exec node scripts/cli/index.js

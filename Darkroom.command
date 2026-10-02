#!/bin/bash
# macOS double-click launcher — self-contained Node bootstrap.
cd "$(dirname "$0")"
ROOT="$(pwd)"

PIN_NODE="22.14.0"
RUNTIME_NODE="$ROOT/runtime/node"
OPS_LOG_DIR="$ROOT/logs/ops"
mkdir -p "$OPS_LOG_DIR" "$RUNTIME_NODE"

arch="$(uname -m)"
case "$arch" in
  x86_64) NODE_ARCH="x64" ;;
  arm64) NODE_ARCH="arm64" ;;
  *) echo "[Darkroom] Unsupported arch: $arch"; read -r -p "Press Enter to close…"; exit 1 ;;
esac
NODE_PLAT="darwin"

find_portable_node() {
  local d
  for d in "$RUNTIME_NODE"/node-v*-"${NODE_PLAT}"-"${NODE_ARCH}"; do
    if [ -x "$d/bin/node" ]; then
      echo "$d/bin/node"
      return 0
    fi
  done
  return 1
}

node_major() {
  "$1" -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

pause_err() {
  echo "$1"
  read -r -p "Press Enter to close…"
  exit 1
}

# Prefer Node 22 (LTS pin). Node 24+ can crash better-sqlite3 native addons.
PIN_MAJOR="${PIN_NODE%%.*}"
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  SYS_MAJOR="$(node_major "$(command -v node)")"
  if [ "$SYS_MAJOR" = "$PIN_MAJOR" ]; then
    NODE_BIN="$(command -v node)"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  if PORTABLE="$(find_portable_node)"; then
    P_MAJOR="$(node_major "$PORTABLE")"
    if [ "$P_MAJOR" = "$PIN_MAJOR" ]; then
      NODE_BIN="$PORTABLE"
    fi
  fi
fi

if [ -z "$NODE_BIN" ]; then
  echo "[Darkroom] Node.js ${PIN_MAJOR} not found — downloading portable Node v${PIN_NODE}…"
  LOG="$OPS_LOG_DIR/$(date -u +%Y-%m-%dT%H-%M-%SZ)-node-bootstrap.log"
  ARCHIVE="node-v${PIN_NODE}-${NODE_PLAT}-${NODE_ARCH}.tar.gz"
  URL="https://nodejs.org/dist/v${PIN_NODE}/${ARCHIVE}"
  TMP="$RUNTIME_NODE/${ARCHIVE}"
  {
    echo "Downloading $URL"
    curl -fL --retry 3 --retry-delay 2 -o "$TMP" "$URL" || pause_err "[Darkroom] Download failed."
    tar -xzf "$TMP" -C "$RUNTIME_NODE" || pause_err "[Darkroom] Extract failed."
    rm -f "$TMP"
    echo "OK"
  } | tee "$LOG"
  NODE_BIN="$(find_portable_node)" || pause_err "[Darkroom] Portable Node not found after extract."
fi

NPM_BIN="$(dirname "$NODE_BIN")/npm"

# Put this Node first so npm/node-gyp never pick a different major from PATH.
export PATH="$(dirname "$NODE_BIN"):$PATH"

sqlite_ok() {
  # bare require() only loads JS — native addon loads on new Database()
  "$NODE_BIN" -e "const D=require('better-sqlite3'); const d=new D(':memory:'); d.close();" >/dev/null 2>&1
}

if [ ! -d "$ROOT/node_modules/@clack/prompts" ]; then
  echo "[Darkroom] Installing dependencies…"
  if [ -f "$ROOT/package-lock.json" ]; then
    "$NPM_BIN" ci --prefix "$ROOT" || "$NPM_BIN" install --prefix "$ROOT" || pause_err "[Darkroom] npm install failed."
  else
    "$NPM_BIN" install --prefix "$ROOT" || pause_err "[Darkroom] npm install failed."
  fi
  echo "[Darkroom] Rebuilding native modules for Node $($NODE_BIN -v)…"
  "$NPM_BIN" rebuild better-sqlite3 --prefix "$ROOT" || pause_err "[Darkroom] npm rebuild failed."
elif ! sqlite_ok; then
  echo "[Darkroom] Rebuilding native modules for Node $($NODE_BIN -v)…"
  "$NPM_BIN" rebuild better-sqlite3 --prefix "$ROOT" || pause_err "[Darkroom] npm rebuild failed."
fi

exec "$NODE_BIN" "$ROOT/scripts/cli/index.js"

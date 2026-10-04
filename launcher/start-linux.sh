#!/usr/bin/env bash
# Linux / generic Unix launcher — self-contained Node bootstrap. Run from anywhere:
#   ./launcher/start-linux.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PIN_NODE="22.14.0"
# Portable Node lives in dependencies/runtime/node (older installs: runtime/node)
RUNTIME_NODE="$ROOT/dependencies/runtime/node"
if [ ! -d "$ROOT/dependencies/runtime" ] && [ -d "$ROOT/runtime" ]; then
  RUNTIME_NODE="$ROOT/runtime/node"
fi
OPS_LOG_DIR="$ROOT/logs/ops"
mkdir -p "$OPS_LOG_DIR" "$RUNTIME_NODE"
# Node folders an update or reinstall left for the next start (see launcher/components/node.js)
if [ -f "$RUNTIME_NODE/.remove" ]; then
  while IFS= read -r d || [ -n "$d" ]; do
    d="${d%$'\r'}"
    case "$d" in node-v*) rm -rf "${RUNTIME_NODE:?}/$d" ;; esac
  done < "$RUNTIME_NODE/.remove"
  rm -f "$RUNTIME_NODE/.remove"
fi

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) NODE_ARCH="x64" ;;
  arm64|aarch64) NODE_ARCH="arm64" ;;
  *) echo "[Darkroom] Unsupported arch: $arch"; exit 1 ;;
esac

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$os" in
  linux*) NODE_PLAT="linux" ;;
  darwin*) NODE_PLAT="darwin" ;;
  *) echo "[Darkroom] Unsupported OS: $os"; exit 1 ;;
esac

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

# Prefer Node 22 (LTS pin). Node 24+ can crash better-sqlite3 native addons.
PIN_MAJOR="${PIN_NODE%%.*}"
NODE_BIN=""
# DARKROOM_FORCE_PORTABLE_NODE=1 ignores an installed Node (CI uses it to test the download)
if [ -z "${DARKROOM_FORCE_PORTABLE_NODE:-}" ] && command -v node >/dev/null 2>&1; then
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
    if command -v curl >/dev/null 2>&1; then
      curl -fL --retry 3 --retry-delay 2 -o "$TMP" "$URL"
    else
      wget -O "$TMP" "$URL"
    fi
    tar -xzf "$TMP" -C "$RUNTIME_NODE"
    rm -f "$TMP"
    echo "OK"
  } | tee "$LOG"
  NODE_BIN="$(find_portable_node)" || {
    echo "[Darkroom] Portable Node extract failed."
    exit 1
  }
fi

NPM_BIN="$(dirname "$NODE_BIN")/npm"
if [ ! -x "$NPM_BIN" ]; then
  NPM_BIN="$(command -v npm || true)"
fi

# Put this Node first so npm/node-gyp never pick a different major from PATH.
export PATH="$(dirname "$NODE_BIN"):$PATH"

sqlite_ok() {
  # bare require() only loads JS — native addon loads on new Database()
  "$NODE_BIN" -e "const D=require('better-sqlite3'); const d=new D(':memory:'); d.close();" >/dev/null 2>&1
}

if [ ! -d "$ROOT/node_modules/@clack/prompts" ]; then
  echo "[Darkroom] Installing dependencies…"
  if [ -f "$ROOT/package-lock.json" ]; then
    "$NPM_BIN" ci --prefix "$ROOT" || "$NPM_BIN" install --prefix "$ROOT"
  else
    "$NPM_BIN" install --prefix "$ROOT"
  fi
  echo "[Darkroom] Rebuilding native modules for Node $($NODE_BIN -v)…"
  "$NPM_BIN" rebuild better-sqlite3 --prefix "$ROOT"
elif ! sqlite_ok; then
  echo "[Darkroom] Rebuilding native modules for Node $($NODE_BIN -v)…"
  "$NPM_BIN" rebuild better-sqlite3 --prefix "$ROOT"
fi

# --bootstrap-only: stop once Node and the dependencies are ready (CI checks this file this way)
if [ "${1:-}" = "--bootstrap-only" ]; then
  echo "[Darkroom] Bootstrap OK - Node $("$NODE_BIN" -v) at $NODE_BIN"
  exit 0
fi

exec "$NODE_BIN" "$ROOT/launcher/index.js"

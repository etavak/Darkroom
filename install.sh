#!/usr/bin/env bash
# One-liner installer for macOS (and Linux): clone/update ~/Darkroom, then launch.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/etavak/Darkroom/main/install.sh | bash
set -euo pipefail

REPO_URL="${DARKROOM_REPO_URL:-https://github.com/etavak/Darkroom.git}"
DEST="${DARKROOM_HOME:-$HOME/Darkroom}"

echo "[Darkroom] Install target: $DEST"

have_git() {
  command -v git >/dev/null 2>&1
}

wait_for_git() {
  local timeout_s="${1:-1200}"
  local start
  start="$(date +%s)"
  echo "[Darkroom] Waiting for git (finish the Xcode Command Line Tools installer if prompted)…"
  while true; do
    if have_git; then
      echo "[Darkroom] git ready: $(git --version 2>/dev/null || true)"
      return 0
    fi
    if [ "$(( $(date +%s) - start ))" -ge "$timeout_s" ]; then
      echo "[Darkroom] Timed out waiting for git."
      echo "Install Xcode Command Line Tools (xcode-select --install), then re-run this script."
      exit 1
    fi
    sleep 3
  done
}

if ! have_git; then
  if [ "$(uname -s)" = "Darwin" ]; then
    echo "[Darkroom] git not found."
    echo "macOS needs the Xcode Command Line Tools for git."
    echo "A system dialog should appear — click Install and wait."
    echo "This script will wait until git is available, then continue."
    if command -v xcode-select >/dev/null 2>&1; then
      xcode-select --install 2>/dev/null || true
    else
      echo "[Darkroom] xcode-select not found. Install Command Line Tools from Apple, then retry."
      exit 1
    fi
    wait_for_git 1200
  else
    echo "[Darkroom] git is required. Install git (e.g. apt install git), then re-run."
    exit 1
  fi
fi

if [ -d "$DEST/.git" ]; then
  echo "[Darkroom] Existing checkout found — updating…"
  git -C "$DEST" pull --ff-only || {
    echo "[Darkroom] git pull failed. Fix the repo at $DEST, or set DARKROOM_HOME to another path."
    exit 1
  }
elif [ -e "$DEST" ]; then
  echo "[Darkroom] $DEST exists but is not a git checkout."
  echo "Move it aside, or set DARKROOM_HOME to a different folder, then re-run."
  exit 1
else
  echo "[Darkroom] Cloning $REPO_URL → $DEST …"
  git clone --depth 1 "$REPO_URL" "$DEST"
fi

chmod +x "$DEST/Start Darkroom (Mac).command" "$DEST/launcher/start-linux.sh" 2>/dev/null || true

echo "[Darkroom] Launching…"
if [ "$(uname -s)" = "Darwin" ]; then
  # Run via bash so Gatekeeper does not block a downloaded .command as an app launch.
  exec bash "$DEST/Start Darkroom (Mac).command"
fi
exec bash "$DEST/launcher/start-linux.sh"

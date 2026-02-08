#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LOCAL_SKILL_ROOT="${LOCAL_SKILL_ROOT:-${CODEX_HOME:-$HOME/.codex}/skills/fix-app-bugs}"
REPO_SKILL_ROOT="${REPO_SKILL_ROOT:-$REPO_ROOT/skills/fix-app-bugs}"

usage() {
  echo "Usage: bash scripts/sync-fix-app-bugs-skill.sh --from-local|--to-local"
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

MODE="$1"
if [[ "$MODE" != "--from-local" && "$MODE" != "--to-local" ]]; then
  usage
  exit 1
fi

if [[ "$MODE" == "--from-local" ]]; then
  SRC="$LOCAL_SKILL_ROOT"
  DST="$REPO_SKILL_ROOT"
else
  SRC="$REPO_SKILL_ROOT"
  DST="$LOCAL_SKILL_ROOT"
fi

if [[ ! -d "$SRC" ]]; then
  echo "sync-fix-app-bugs-skill: source directory does not exist: $SRC"
  exit 1
fi

mkdir -p "$DST"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude "__pycache__/" --exclude "*.pyc" --exclude ".DS_Store" "$SRC/" "$DST/"
else
  find "$DST" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -R "$SRC/." "$DST/"
  find "$DST" -type d -name "__pycache__" -prune -exec rm -rf {} +
  find "$DST" -type f -name "*.pyc" -delete
  find "$DST" -type f -name ".DS_Store" -delete
fi

echo "sync-fix-app-bugs-skill: synced $SRC -> $DST"

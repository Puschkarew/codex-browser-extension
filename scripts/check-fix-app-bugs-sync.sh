#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LOCAL_SKILL_ROOT="${LOCAL_SKILL_ROOT:-${CODEX_HOME:-$HOME/.codex}/skills/fix-app-bugs}"
REPO_SKILL_ROOT="${REPO_SKILL_ROOT:-$REPO_ROOT/skills/fix-app-bugs}"

if [[ ! -d "$LOCAL_SKILL_ROOT" ]]; then
  echo "check-fix-app-bugs-sync: local skill directory missing: $LOCAL_SKILL_ROOT"
  exit 1
fi

if [[ ! -d "$REPO_SKILL_ROOT" ]]; then
  echo "check-fix-app-bugs-sync: repo mirror directory missing: $REPO_SKILL_ROOT"
  exit 1
fi

TMP_LOCAL="$(mktemp -d -t fix-app-bugs-local.XXXXXX)"
TMP_REPO="$(mktemp -d -t fix-app-bugs-repo.XXXXXX)"
trap 'rm -rf "$TMP_LOCAL" "$TMP_REPO"' EXIT

copy_normalized() {
  local src="$1"
  local dst="$2"
  mkdir -p "$dst"

  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete --exclude "__pycache__/" --exclude "*.pyc" --exclude ".DS_Store" "$src/" "$dst/"
  else
    cp -R "$src/." "$dst/"
    find "$dst" -type d -name "__pycache__" -prune -exec rm -rf {} +
    find "$dst" -type f -name "*.pyc" -delete
    find "$dst" -type f -name ".DS_Store" -delete
  fi
}

copy_normalized "$LOCAL_SKILL_ROOT" "$TMP_LOCAL"
copy_normalized "$REPO_SKILL_ROOT" "$TMP_REPO"

set +e
DIFF_OUTPUT="$(diff -ru "$TMP_LOCAL" "$TMP_REPO")"
DIFF_STATUS=$?
set -e

if [[ "$DIFF_STATUS" -ne 0 ]]; then
  echo "$DIFF_OUTPUT"
  echo
  echo "check-fix-app-bugs-sync: local skill and repo mirror are out of sync."
  echo "Run: npm run skill:sync:from-local"
  exit 2
fi

echo "check-fix-app-bugs-sync: local skill and repo mirror are in sync."

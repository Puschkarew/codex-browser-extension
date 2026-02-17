#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

LOCAL_CONTRACT_DIR="${LOCAL_CONTRACT_DIR:-${CODEX_HOME:-$HOME/.codex}/skills/workflows-shared/references}"
REPO_CONTRACT_DIR="${REPO_CONTRACT_DIR:-$REPO_ROOT/docs/contracts}"

FILES=(
  "auto-routing-contract.md"
  "auto-routing-capability-map.md"
)

if [[ ! -d "$LOCAL_CONTRACT_DIR" ]]; then
  echo "check-auto-routing-contract-sync: local directory missing: $LOCAL_CONTRACT_DIR"
  exit 1
fi

if [[ ! -d "$REPO_CONTRACT_DIR" ]]; then
  echo "check-auto-routing-contract-sync: repo directory missing: $REPO_CONTRACT_DIR"
  exit 1
fi

DIFF_FOUND=0
for filename in "${FILES[@]}"; do
  LOCAL_FILE="$LOCAL_CONTRACT_DIR/$filename"
  REPO_FILE="$REPO_CONTRACT_DIR/$filename"

  if [[ ! -f "$LOCAL_FILE" ]]; then
    echo "check-auto-routing-contract-sync: missing local file: $LOCAL_FILE"
    exit 1
  fi
  if [[ ! -f "$REPO_FILE" ]]; then
    echo "check-auto-routing-contract-sync: missing repo file: $REPO_FILE"
    exit 1
  fi

  set +e
  DIFF_OUTPUT="$(diff -u "$LOCAL_FILE" "$REPO_FILE")"
  DIFF_STATUS=$?
  set -e

  if [[ "$DIFF_STATUS" -ne 0 ]]; then
    DIFF_FOUND=1
    echo "$DIFF_OUTPUT"
  fi
done

if [[ "$DIFF_FOUND" -ne 0 ]]; then
  echo
  echo "check-auto-routing-contract-sync: local and repo mirrors are out of sync."
  echo "Run: npm run routing:sync:from-local"
  exit 2
fi

echo "check-auto-routing-contract-sync: local and repo mirrors are in sync."

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

usage() {
  echo "Usage: bash scripts/sync-auto-routing-contract.sh --from-local|--to-local"
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
  SRC_DIR="$LOCAL_CONTRACT_DIR"
  DST_DIR="$REPO_CONTRACT_DIR"
else
  SRC_DIR="$REPO_CONTRACT_DIR"
  DST_DIR="$LOCAL_CONTRACT_DIR"
fi

if [[ ! -d "$SRC_DIR" ]]; then
  echo "sync-auto-routing-contract: source directory does not exist: $SRC_DIR"
  exit 1
fi

mkdir -p "$DST_DIR"

for filename in "${FILES[@]}"; do
  if [[ ! -f "$SRC_DIR/$filename" ]]; then
    echo "sync-auto-routing-contract: missing source file: $SRC_DIR/$filename"
    exit 1
  fi
  cp "$SRC_DIR/$filename" "$DST_DIR/$filename"
done

echo "sync-auto-routing-contract: synced $SRC_DIR -> $DST_DIR"

#!/usr/bin/env bash
set -euo pipefail

# Guarded cleanup entrypoint for fix-app-bugs.
# It delegates to check_instrumentation_cleanup.sh when available.
# If the script is missing, it falls back to a deterministic grep/rg scan.

ROOT="."
STRICT="0"
CLEANUP_SCRIPT_OVERRIDE=""
CODE_GLOBS=(
  "*.ts"
  "*.tsx"
  "*.js"
  "*.jsx"
  "*.mjs"
  "*.cjs"
  "*.vue"
  "*.svelte"
  "*.py"
  "*.sh"
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --strict)
      STRICT="1"
      shift
      ;;
    --cleanup-script)
      CLEANUP_SCRIPT_OVERRIDE="${2:-}"
      shift 2
      ;;
    *)
      ROOT="$1"
      shift
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
SELF_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

collect_runtime_targets() {
  local root="$1"
  local targets_ref_name="$2"
  local target
  local base_dirs=(src app lib client server web frontend backend extensions test tests)

  for target in "${base_dirs[@]}"; do
    if [[ -d "$root/$target" ]]; then
      eval "$targets_ref_name+=(\"$root/$target\")"
    fi
  done

  if [[ -d "$root/packages" ]]; then
    local package_src
    while IFS= read -r -d '' package_src; do
      eval "$targets_ref_name+=(\"$package_src\")"
    done < <(find "$root/packages" -mindepth 2 -maxdepth 2 -type d -name src -print0 2>/dev/null)
  fi
}

build_find_args_for_code_files() {
  local args_ref_name="$1"
  local idx

  eval "$args_ref_name=()"
  for idx in "${!CODE_GLOBS[@]}"; do
    if [[ "$idx" -gt 0 ]]; then
      eval "$args_ref_name+=(\"-o\")"
    fi
    eval "$args_ref_name+=(\"-name\" \"${CODE_GLOBS[$idx]}\")"
  done
}

scan_with_grep_strict() {
  local pattern="$1"
  shift
  local targets=("$@")
  local -a find_name_args=()
  local found_match="0"

  build_find_args_for_code_files find_name_args

  while IFS= read -r -d '' file_path; do
    if grep -nE "$pattern" "$file_path"; then
      found_match="1"
    fi
  done < <(
    find "${targets[@]}" \
      -type f \
      \( "${find_name_args[@]}" \) \
      ! -path "*/.git/*" \
      ! -path "*/node_modules/*" \
      -print0 2>/dev/null
  )

  if [[ "$found_match" == "1" ]]; then
    return 0
  fi

  return 1
}

find_cleanup_script() {
  local candidate
  local candidates=()

  if [[ -n "$CLEANUP_SCRIPT_OVERRIDE" ]]; then
    if [[ -f "$CLEANUP_SCRIPT_OVERRIDE" ]]; then
      echo "$CLEANUP_SCRIPT_OVERRIDE"
      return 0
    fi
    return 1
  fi

  candidates=(
    "$SCRIPT_DIR/check_instrumentation_cleanup.sh"
    "$CODEX_HOME_DIR/skills/fix-app-bugs/scripts/check_instrumentation_cleanup.sh"
    "$HOME/.codex/skills/fix-app-bugs/scripts/check_instrumentation_cleanup.sh"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -z "$candidate" ]]; then
      continue
    fi
    if [[ -f "$candidate" ]]; then
      local resolved
      resolved="$(cd "$(dirname "$candidate")" && pwd)/$(basename "$candidate")"
      if [[ "$resolved" == "$SELF_PATH" ]]; then
        continue
      fi
      echo "$candidate"
      return 0
    fi
  done

  return 1
}

if cleanup_script="$(find_cleanup_script)"; then
  if [[ "$STRICT" == "1" ]]; then
    bash "$cleanup_script" "$ROOT" --strict
  else
    bash "$cleanup_script" "$ROOT"
  fi
  exit $?
fi

echo "cleanup_guarded: check_instrumentation_cleanup.sh not found, using fallback scan."

if [[ "$STRICT" == "1" ]]; then
  PATTERN="BUGFIX_TRACE"
else
  PATTERN="BUGFIX_TRACE|debugEndpoint|traceId|issue tag"
fi
targets=()
collect_runtime_targets "$ROOT" targets

if [[ ${#targets[@]} -eq 0 ]]; then
  targets=("$ROOT")
fi

if command -v rg >/dev/null 2>&1; then
  if [[ "$STRICT" == "1" ]]; then
    rg_globs=()
    for glob in "${CODE_GLOBS[@]}"; do
      rg_globs+=(--glob "$glob")
    done
    if rg -n --hidden --glob '!.git' --glob '!node_modules' "${rg_globs[@]}" "$PATTERN" "${targets[@]}"; then
      echo
      echo "cleanup_guarded: fallback scan found leftover instrumentation references."
      exit 2
    fi
  elif rg -n --hidden --glob '!.git' --glob '!node_modules' "$PATTERN" "${targets[@]}"; then
    echo
    echo "cleanup_guarded: fallback scan found leftover instrumentation references."
    exit 2
  fi
else
  if [[ "$STRICT" == "1" ]]; then
    if scan_with_grep_strict "$PATTERN" "${targets[@]}"; then
      echo
      echo "cleanup_guarded: fallback scan found leftover instrumentation references."
      exit 2
    fi
  elif grep -RIn --exclude-dir=.git --exclude-dir=node_modules -E "$PATTERN" "${targets[@]}"; then
    echo
    echo "cleanup_guarded: fallback scan found leftover instrumentation references."
    exit 2
  fi
fi

echo "cleanup_guarded: no instrumentation leftovers found in fallback scan."
exit 0

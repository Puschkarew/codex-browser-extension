#!/usr/bin/env bash
set -euo pipefail

# Verify that temporary bug-trace markers are removed before finishing.
# Default mode: only checks explicit marker comments.
# Strict mode: checks any BUGFIX_TRACE usage in runtime code paths.

ROOT="."
STRICT="0"
MARKER="BUGFIX_TRACE"
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

for arg in "$@"; do
  case "$arg" in
    --strict)
      STRICT="1"
      ;;
    *)
      ROOT="$arg"
      ;;
  esac
done

targets=()
collect_runtime_targets "$ROOT" targets
if [[ ${#targets[@]} -eq 0 ]]; then
  targets=("$ROOT")
fi

if [[ "$STRICT" == "1" ]]; then
  PATTERN="$MARKER"
  MESSAGE="Found leftover instrumentation marker '$MARKER' in runtime code paths. Remove these traces before finishing."
else
  PATTERN="BUGFIX_TRACE[[:space:]]+(begin\\(|end\\()"
  MESSAGE="Found leftover BUGFIX_TRACE begin/end markers. Remove temporary instrumentation blocks before finishing."
fi

if command -v rg >/dev/null 2>&1; then
  if [[ "$STRICT" == "1" ]]; then
    rg_globs=()
    for glob in "${CODE_GLOBS[@]}"; do
      rg_globs+=(--glob "$glob")
    done
    if rg -n --hidden --glob '!.git' --glob '!node_modules' "${rg_globs[@]}" --pcre2 "$PATTERN" "${targets[@]}"; then
      echo
      echo "$MESSAGE"
      exit 2
    fi
  elif rg -n --hidden --glob '!.git' --glob '!node_modules' --pcre2 "$PATTERN" "${targets[@]}"; then
    echo
    echo "$MESSAGE"
    exit 2
  fi
else
  if [[ "$STRICT" == "1" ]]; then
    if scan_with_grep_strict "$PATTERN" "${targets[@]}"; then
      echo
      echo "$MESSAGE"
      exit 2
    fi
  elif grep -RIn --exclude-dir=.git --exclude-dir=node_modules -E "$PATTERN" "${targets[@]}"; then
    echo
    echo "$MESSAGE"
    exit 2
  fi
fi

if [[ "$STRICT" == "1" ]]; then
  echo "No '$MARKER' markers found under $ROOT."
else
  echo "No BUGFIX_TRACE begin/end markers found under $ROOT."
fi

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARDED_SCRIPT="$SCRIPT_DIR/cleanup_guarded.sh"
CHECK_SCRIPT="$SCRIPT_DIR/check_instrumentation_cleanup.sh"

tmp_root="$(mktemp -d -t cleanup-guarded-smoke.XXXXXX)"
trap 'rm -rf "$tmp_root"' EXIT

project_clean="$tmp_root/project-clean"
mkdir -p "$project_clean/src" "$project_clean/test"

set +e
bash "$GUARDED_SCRIPT" "$project_clean" --cleanup-script "$tmp_root/missing_cleanup.sh"
status_clean=$?
set -e
if [[ "$status_clean" -ne 0 ]]; then
  echo "Expected clean fallback scan to pass, got exit code $status_clean"
  exit 1
fi

project_dirty="$tmp_root/project-dirty"
mkdir -p "$project_dirty/src" "$project_dirty/test"
cat >"$project_dirty/src/trace.ts" <<'EOF'
// BUGFIX_TRACE begin(checkout-submit)
const traceId = "x";
EOF

set +e
bash "$GUARDED_SCRIPT" "$project_dirty" --cleanup-script "$tmp_root/missing_cleanup.sh"
status_dirty=$?
set -e
if [[ "$status_dirty" -ne 2 ]]; then
  echo "Expected dirty fallback scan to fail with exit code 2, got $status_dirty"
  exit 1
fi

project_dirty_text="$tmp_root/project-dirty-text"
mkdir -p "$project_dirty_text/src" "$project_dirty_text/test"
cat >"$project_dirty_text/test/debug.txt" <<'EOF'
issue tag: checkout-submit
debugEndpoint = http://127.0.0.1:7331/debug
EOF

set +e
bash "$GUARDED_SCRIPT" "$project_dirty_text" --cleanup-script "$tmp_root/missing_cleanup.sh"
status_dirty_text=$?
set -e
if [[ "$status_dirty_text" -ne 2 ]]; then
  echo "Expected textual leftovers to fail with exit code 2, got $status_dirty_text"
  exit 1
fi

project_docs_only="$tmp_root/project-docs-only"
mkdir -p "$project_docs_only/docs"
cat >"$project_docs_only/docs/feedback.md" <<'EOF'
BUGFIX_TRACE is mentioned in documentation and should not fail strict runtime scan.
EOF

set +e
bash "$CHECK_SCRIPT" "$project_docs_only" --strict
status_docs_only=$?
set -e
if [[ "$status_docs_only" -ne 0 ]]; then
  echo "Expected strict cleanup to ignore documentation-only marker, got exit code $status_docs_only"
  exit 1
fi

project_runtime_strict="$tmp_root/project-runtime-strict"
mkdir -p "$project_runtime_strict/src"
cat >"$project_runtime_strict/src/trace.ts" <<'EOF'
const marker = "BUGFIX_TRACE";
EOF

set +e
bash "$CHECK_SCRIPT" "$project_runtime_strict" --strict
status_runtime_strict=$?
set -e
if [[ "$status_runtime_strict" -ne 2 ]]; then
  echo "Expected strict cleanup to fail on runtime marker with exit code 2, got $status_runtime_strict"
  exit 1
fi

project_docs_fallback_strict="$tmp_root/project-docs-fallback-strict"
mkdir -p "$project_docs_fallback_strict/docs"
cat >"$project_docs_fallback_strict/docs/feedback.md" <<'EOF'
BUGFIX_TRACE in docs should not fail strict fallback cleanup.
EOF

set +e
bash "$GUARDED_SCRIPT" "$project_docs_fallback_strict" --strict --cleanup-script "$tmp_root/missing_cleanup.sh"
status_docs_fallback_strict=$?
set -e
if [[ "$status_docs_fallback_strict" -ne 0 ]]; then
  echo "Expected strict fallback cleanup to ignore docs-only markers, got exit code $status_docs_fallback_strict"
  exit 1
fi

project_runtime_fallback_strict="$tmp_root/project-runtime-fallback-strict"
mkdir -p "$project_runtime_fallback_strict/src"
cat >"$project_runtime_fallback_strict/src/trace.ts" <<'EOF'
const marker = "BUGFIX_TRACE";
EOF

set +e
bash "$GUARDED_SCRIPT" "$project_runtime_fallback_strict" --strict --cleanup-script "$tmp_root/missing_cleanup.sh"
status_runtime_fallback_strict=$?
set -e
if [[ "$status_runtime_fallback_strict" -ne 2 ]]; then
  echo "Expected strict fallback cleanup to fail on runtime marker with exit code 2, got $status_runtime_fallback_strict"
  exit 1
fi

echo "cleanup_guarded smoke checks passed"

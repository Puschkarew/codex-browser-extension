#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

python3 "$SCRIPT_DIR/test_bootstrap_guarded.py"
python3 "$SCRIPT_DIR/test_bootstrap_browser_debug.py"
python3 "$SCRIPT_DIR/test_terminal_probe_pipeline.py"
bash "$SCRIPT_DIR/test_cleanup_guarded.sh"

echo "All fix-app-bugs guardrail smoke checks passed."

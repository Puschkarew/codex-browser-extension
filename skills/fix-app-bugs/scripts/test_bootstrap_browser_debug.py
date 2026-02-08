#!/usr/bin/env python3
"""Smoke/regression tests for bootstrap_browser_debug.py diagnostics."""

from __future__ import annotations

import importlib.util
import os
import tempfile
from pathlib import Path
from types import ModuleType


SCRIPT_PATH = Path(__file__).resolve().parent / "bootstrap_browser_debug.py"


def load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("bootstrap_browser_debug", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load bootstrap_browser_debug.py module spec")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def run_playwright_check(
    module: ModuleType,
    wrapper_path: Path,
    npx_path: Path,
) -> dict:
    original_wrapper = os.environ.get("PLAYWRIGHT_WRAPPER_PATH")
    os.environ["PLAYWRIGHT_WRAPPER_PATH"] = str(wrapper_path)
    try:
        return module.check_playwright_tool({"ok": True, "path": str(npx_path)})
    finally:
        if original_wrapper is None:
            os.environ.pop("PLAYWRIGHT_WRAPPER_PATH", None)
        else:
            os.environ["PLAYWRIGHT_WRAPPER_PATH"] = original_wrapper


def main() -> int:
    module = load_module()

    app_url_check = module.enrich_app_url_check(
        module.evaluate_app_url_check("http://localhost:3000", "http://localhost:5173"),
        project_root=Path("/tmp/sample-project"),
        actual_app_url="http://localhost:5173",
        recommended_actual_app_url=None,
        has_recommendations=True,
        applied_recommendations=False,
    )
    assert app_url_check["status"] == "mismatch", app_url_check
    assert app_url_check["ok"] is False, app_url_check
    assert isinstance(app_url_check["checklist"], list), app_url_check
    assert isinstance(app_url_check["recommendedCommands"], list), app_url_check
    assert app_url_check["canAutoFix"] is True, app_url_check
    assert app_url_check["autoFixMode"] == "explicit-flag", app_url_check
    assert app_url_check["nextAction"] == "apply-recommended", app_url_check
    assert app_url_check["recommendedCommands"][0]["id"] == "apply-recommended-app-url-fix", app_url_check

    strict_gate_check = module.enrich_app_url_check(
        module.evaluate_app_url_check("http://localhost:3000", None),
        project_root=Path("/tmp/sample-project"),
        actual_app_url=None,
        recommended_actual_app_url="http://127.0.0.1:5173",
        has_recommendations=False,
        applied_recommendations=False,
    )
    assert strict_gate_check["status"] == "not-provided", strict_gate_check
    assert strict_gate_check["ok"] is False, strict_gate_check
    assert strict_gate_check["required"] is True, strict_gate_check
    assert strict_gate_check["recommendedActualAppUrl"] == "http://127.0.0.1:5173", strict_gate_check
    assert strict_gate_check["checklist"][0]["pass"] is False, strict_gate_check
    assert strict_gate_check["nextAction"] == "provide-actual-app-url", strict_gate_check

    loopback_equivalent_check = module.enrich_app_url_check(
        module.evaluate_app_url_check("http://localhost:5173", "http://127.0.0.1:5173"),
        project_root=Path("/tmp/sample-project"),
        actual_app_url="http://127.0.0.1:5173",
        recommended_actual_app_url=None,
        has_recommendations=True,
        applied_recommendations=False,
    )
    assert loopback_equivalent_check["status"] == "match", loopback_equivalent_check
    assert loopback_equivalent_check["matchType"] == "loopback-equivalent", loopback_equivalent_check
    assert loopback_equivalent_check["needsConfigSync"] is True, loopback_equivalent_check
    assert loopback_equivalent_check["recommendedCommands"][0]["id"] == "optional-sync-app-url", loopback_equivalent_check
    assert loopback_equivalent_check["nextAction"] == "optional-sync", loopback_equivalent_check

    mismatch_category = module.classify_instrumentation_failure(
        {
            "appUrl": {"ok": False, "status": "mismatch"},
            "preflight": {"ok": False, "status": 403},
            "debugPost": {"ok": False, "status": 403},
            "query": {"ok": False, "status": None, "reason": "skipped because debugPost failed"},
        }
    )
    assert mismatch_category["category"] == "network-mismatch-only", mismatch_category

    endpoint_category = module.classify_instrumentation_failure(
        {
            "appUrl": {"ok": True, "status": "match"},
            "preflight": {"ok": False, "status": None, "reason": "Connection refused"},
            "debugPost": {"ok": False, "status": None, "reason": "Connection refused"},
            "query": {"ok": False, "status": None, "reason": "Connection refused"},
        }
    )
    assert endpoint_category["category"] == "endpoint-unavailable", endpoint_category

    headed_warning = module.build_headed_evidence_check({"ok": True, "headlessLikely": True})
    assert headed_warning["ok"] is False, headed_warning
    assert isinstance(headed_warning["warning"], str), headed_warning

    with tempfile.TemporaryDirectory(prefix="bootstrap-browser-debug-smoke-") as temp_dir:
        root = Path(temp_dir)

        wrapper_ok = root / "wrapper_ok.sh"
        write_executable(
            wrapper_ok,
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            "exit 0\n",
        )
        npx_ok = root / "npx_ok.sh"
        write_executable(
            npx_ok,
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            "for arg in \"$@\"; do\n"
            "  if [[ \"$arg\" == \"playwright-mcp\" ]]; then\n"
            "    exit 0\n"
            "  fi\n"
            "done\n"
            "exit 7\n",
        )

        result_wrapper_ok = run_playwright_check(module, wrapper_ok, npx_ok)
        assert result_wrapper_ok["ok"] is True, result_wrapper_ok
        assert result_wrapper_ok["mode"] == "wrapper", result_wrapper_ok
        assert result_wrapper_ok["wrapperSmoke"]["ok"] is True, result_wrapper_ok
        assert "selectedCommand" in result_wrapper_ok, result_wrapper_ok

        wrapper_fail = root / "wrapper_fail.sh"
        write_executable(
            wrapper_fail,
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            "exit 9\n",
        )

        result_wrapper_fail_npx_ok = run_playwright_check(module, wrapper_fail, npx_ok)
        assert result_wrapper_fail_npx_ok["ok"] is True, result_wrapper_fail_npx_ok
        assert result_wrapper_fail_npx_ok["mode"] == "npx-fallback", result_wrapper_fail_npx_ok
        assert result_wrapper_fail_npx_ok["wrapperSmoke"]["ok"] is False, result_wrapper_fail_npx_ok
        assert result_wrapper_fail_npx_ok["npxSmoke"]["ok"] is True, result_wrapper_fail_npx_ok
        assert result_wrapper_fail_npx_ok["selectedBinary"] == "playwright-mcp", result_wrapper_fail_npx_ok

        npx_fail = root / "npx_fail.sh"
        write_executable(
            npx_fail,
            "#!/usr/bin/env bash\n"
            "set -euo pipefail\n"
            "exit 11\n",
        )

        result_wrapper_fail_npx_fail = run_playwright_check(module, wrapper_fail, npx_fail)
        assert result_wrapper_fail_npx_fail["ok"] is False, result_wrapper_fail_npx_fail
        assert result_wrapper_fail_npx_fail["mode"] == "unavailable", result_wrapper_fail_npx_fail
        assert result_wrapper_fail_npx_fail["wrapperSmoke"]["ok"] is False, result_wrapper_fail_npx_fail
        assert result_wrapper_fail_npx_fail["npxSmoke"]["ok"] is False, result_wrapper_fail_npx_fail

    print("bootstrap_browser_debug playwright diagnostics smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

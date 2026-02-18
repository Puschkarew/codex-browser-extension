#!/usr/bin/env python3
"""Smoke/regression tests for bootstrap_guarded.py."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parent / "bootstrap_guarded.py"


def write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def run_case(project_root: Path, bootstrap_script: Path) -> tuple[int, dict]:
    result = subprocess.run(
        [
            "python3",
            str(SCRIPT_PATH),
            "--project-root",
            str(project_root),
            "--bootstrap-script",
            str(bootstrap_script),
            "--json",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    return result.returncode, payload


def assert_fallback(payload: dict, reason_contains: str) -> None:
    assert payload["bootstrap"]["status"] == "fallback", payload
    assert reason_contains in payload["bootstrap"]["reason"], payload
    assert payload["browserInstrumentation"]["canInstrumentFromBrowser"] is False, payload
    assert payload["browserInstrumentation"]["mode"] == "terminal-probe", payload
    assert payload["readyForScenarioRun"] is False, payload
    assert isinstance(payload["readinessReasons"], list) and payload["readinessReasons"], payload
    assert payload["debugEndpoint"] is None, payload
    assert payload["queryEndpoint"] is None, payload
    assert payload["session"]["active"] is False, payload
    assert payload["session"]["sessionId"] is None, payload


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="bootstrap-guarded-smoke-") as temp_dir:
        root = Path(temp_dir)
        project_root = root / "project"
        project_root.mkdir(parents=True, exist_ok=True)

        missing_script = root / "missing_bootstrap.py"
        code, payload = run_case(project_root, missing_script)
        assert code == 0
        assert_fallback(payload, "bootstrap script not found")

        failing_script = root / "failing_bootstrap.py"
        write_executable(
            failing_script,
            "#!/usr/bin/env python3\n"
            "import sys\n"
            "print('boom', file=sys.stderr)\n"
            "raise SystemExit(7)\n",
        )
        code, payload = run_case(project_root, failing_script)
        assert code == 0
        assert_fallback(payload, "non-zero exit code 7")

        bad_json_script = root / "bad_json_bootstrap.py"
        write_executable(
            bad_json_script,
            "#!/usr/bin/env python3\n"
            "print('not-json')\n",
        )
        code, payload = run_case(project_root, bad_json_script)
        assert code == 0
        assert_fallback(payload, "invalid JSON")

        success_script = root / "success_bootstrap.py"
        write_executable(
            success_script,
            "#!/usr/bin/env python3\n"
            "import json\n"
            "print(json.dumps({\n"
            "  'debugEndpoint': 'http://127.0.0.1:7331/debug',\n"
            "  'queryEndpoint': 'http://127.0.0.1:4678/events/query',\n"
            "  'browserInstrumentation': {\n"
            "    'canInstrumentFromBrowser': True,\n"
            "    'mode': 'browser-fetch',\n"
            "    'reason': None\n"
            "  }\n"
            "}))\n",
        )
        code, payload = run_case(project_root, success_script)
        assert code == 0
        assert payload["bootstrap"]["status"] == "ok", payload
        assert payload["browserInstrumentation"]["canInstrumentFromBrowser"] is True, payload
        assert payload["browserInstrumentation"]["mode"] == "browser-fetch", payload
        assert payload["readyForScenarioRun"] is True, payload
        assert payload["readinessReasons"] == [], payload
        assert payload["debugEndpoint"] == "http://127.0.0.1:7331/debug", payload
        assert payload["queryEndpoint"] == "http://127.0.0.1:4678/events/query", payload
        assert payload["session"]["active"] is False, payload

        success_terminal_probe_script = root / "success_terminal_probe_bootstrap.py"
        write_executable(
            success_terminal_probe_script,
            "#!/usr/bin/env python3\n"
            "import json\n"
            "print(json.dumps({\n"
            "  'browserInstrumentation': {\n"
            "    'canInstrumentFromBrowser': False,\n"
            "    'mode': 'terminal-probe',\n"
            "    'failureCategory': 'network-mismatch-only',\n"
            "    'reason': 'fallback'\n"
            "  },\n"
            "  'session': {\n"
            "    'active': False,\n"
            "    'sessionId': None,\n"
            "    'tabUrl': None,\n"
            "    'state': None\n"
            "  }\n"
            "}))\n",
        )
        code, payload = run_case(project_root, success_terminal_probe_script)
        assert code == 0
        assert payload["readyForScenarioRun"] is True, payload
        assert payload["readinessReasons"] == [], payload

        success_readiness_reasons_script = root / "success_readiness_reasons_bootstrap.py"
        write_executable(
            success_readiness_reasons_script,
            "#!/usr/bin/env python3\n"
            "import json\n"
            "print(json.dumps({\n"
            "  'browserInstrumentation': {\n"
            "    'canInstrumentFromBrowser': True,\n"
            "    'mode': 'browser-fetch',\n"
            "    'reason': None\n"
            "  },\n"
            "  'readyForScenarioRun': False,\n"
            "  'readinessReasons': ['headed-evidence:headless']\n"
            "}))\n",
        )
        code, payload = run_case(project_root, success_readiness_reasons_script)
        assert code == 0
        assert payload["readyForScenarioRun"] is False, payload
        assert payload["readinessReasons"] == ["headed-evidence:headless"], payload
        assert payload["browserInstrumentation"]["readyForScenarioRun"] is False, payload

        success_session_error_script = root / "success_session_error_bootstrap.py"
        write_executable(
            success_session_error_script,
            "#!/usr/bin/env python3\n"
            "import json\n"
            "print(json.dumps({\n"
            "  'browserInstrumentation': {\n"
            "    'canInstrumentFromBrowser': True,\n"
            "    'mode': 'browser-fetch',\n"
            "    'reason': None\n"
            "  },\n"
            "  'session': {\n"
            "    'active': True,\n"
            "    'sessionId': 'session-1',\n"
            "    'tabUrl': 'http://127.0.0.1:5173/',\n"
            "    'state': 'error'\n"
            "  }\n"
            "}))\n",
        )
        code, payload = run_case(project_root, success_session_error_script)
        assert code == 0
        assert payload["readyForScenarioRun"] is False, payload
        assert "session-state:error" in payload["readinessReasons"], payload

    print("bootstrap_guarded smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

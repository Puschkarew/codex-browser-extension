#!/usr/bin/env python3
"""Smoke/regression tests for visual_debug_start.py."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parent / "visual_debug_start.py"


def write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def run_case(
    project_root: Path,
    bootstrap_script: Path,
    terminal_probe_script: Path,
    *,
    extra_args: list[str] | None = None,
) -> tuple[subprocess.CompletedProcess[str], dict]:
    command = [
        "python3",
        str(SCRIPT_PATH),
        "--project-root",
        str(project_root),
        "--actual-app-url",
        "http://127.0.0.1:5173/",
        "--bootstrap-script",
        str(bootstrap_script),
        "--terminal-probe-script",
        str(terminal_probe_script),
        "--json",
    ]
    if extra_args:
        command.extend(extra_args)

    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
    )
    payload = json.loads(completed.stdout)
    return completed, payload


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="visual-debug-start-smoke-") as temp_dir:
        root = Path(temp_dir)
        project_root = root / "project"
        project_root.mkdir(parents=True, exist_ok=True)

        terminal_probe_ok = root / "terminal_probe_ok.py"
        write_executable(
            terminal_probe_ok,
            "#!/usr/bin/env python3\n"
            "import json\n"
            "print(json.dumps({\n"
            "  'ok': True,\n"
            "  'runtimeJsonPath': '/tmp/runtime.json',\n"
            "  'metricsJsonPath': '/tmp/metrics.json',\n"
            "  'summaryJsonPath': '/tmp/summary.json'\n"
            "}))\n",
        )

        bootstrap_terminal_probe = root / "bootstrap_terminal_probe.py"
        write_executable(
            bootstrap_terminal_probe,
            "#!/usr/bin/env python3\n"
            "import json\n"
            "print(json.dumps({\n"
            "  'browserInstrumentation': {\n"
            "    'canInstrumentFromBrowser': False,\n"
            "    'mode': 'terminal-probe',\n"
            "    'reason': None\n"
            "  },\n"
            "  'checks': {\n"
            "    'appUrl': {\n"
            "      'status': 'match',\n"
            "      'configAppUrl': 'http://127.0.0.1:5173/',\n"
            "      'actualAppUrl': 'http://127.0.0.1:5173/'\n"
            "    }\n"
            "  }\n"
            "}))\n",
        )

        completed, payload = run_case(project_root, bootstrap_terminal_probe, terminal_probe_ok)
        assert completed.returncode == 0, completed
        assert payload["exitCode"] == 0, payload
        assert payload["mode"] == "terminal-probe", payload
        assert payload["appUrlStatus"] == "match", payload
        assert isinstance(payload.get("terminalProbe"), dict), payload
        assert payload["terminalProbe"]["exitCode"] == 0, payload
        assert any("summary" in item for item in payload.get("nextActions", [])), payload

        completed_plan_mode, payload_plan_mode = run_case(
            project_root,
            bootstrap_terminal_probe,
            terminal_probe_ok,
            extra_args=["--plan-mode"],
        )
        assert completed_plan_mode.returncode == 0, completed_plan_mode
        assert payload_plan_mode["mode"] == "terminal-probe", payload_plan_mode
        assert payload_plan_mode["terminalProbe"] is None, payload_plan_mode
        assert any("Plan mode" in item for item in payload_plan_mode.get("nextActions", [])), payload_plan_mode

        bootstrap_mismatch = root / "bootstrap_mismatch.py"
        write_executable(
            bootstrap_mismatch,
            "#!/usr/bin/env python3\n"
            "import json\n"
            "print(json.dumps({\n"
            "  'browserInstrumentation': {\n"
            "    'canInstrumentFromBrowser': True,\n"
            "    'mode': 'browser-fetch',\n"
            "    'reason': None\n"
            "  },\n"
            "  'checks': {\n"
            "    'appUrl': {\n"
            "      'status': 'mismatch',\n"
            "      'configAppUrl': 'http://localhost:5173/',\n"
            "      'actualAppUrl': 'http://127.0.0.1:5173/',\n"
            "      'reasonCode': 'APP_URL_ORIGIN_MISMATCH',\n"
            "      'recommendedCommands': [\n"
            "        {\n"
            "          'id': 'apply-recommended-app-url-fix',\n"
            "          'command': 'python3 bootstrap_guarded.py --actual-app-url http://127.0.0.1:5173/ --apply-recommended --json',\n"
            "          'description': 'Apply recommended appUrl fix'\n"
            "        }\n"
            "      ]\n"
            "    }\n"
            "  }\n"
            "}))\n",
        )

        completed_mismatch, payload_mismatch = run_case(project_root, bootstrap_mismatch, terminal_probe_ok)
        assert completed_mismatch.returncode == 0, completed_mismatch
        assert payload_mismatch["exitCode"] == 0, payload_mismatch
        assert payload_mismatch["mode"] == "browser-fetch", payload_mismatch
        assert payload_mismatch["appUrlStatus"] == "mismatch", payload_mismatch
        assert payload_mismatch["terminalProbe"] is None, payload_mismatch
        assert isinstance(payload_mismatch.get("configAlignment"), dict), payload_mismatch
        assert payload_mismatch["configAlignment"]["required"] is True, payload_mismatch
        assert "apply-recommended" in payload_mismatch["configAlignment"]["applyCommand"], payload_mismatch
        assert payload_mismatch["checks"]["reasonCode"] == "APP_URL_ORIGIN_MISMATCH", payload_mismatch
        assert any("Run recommended command:" in item for item in payload_mismatch.get("nextActions", [])), payload_mismatch

        bootstrap_fails = root / "bootstrap_fails.py"
        write_executable(
            bootstrap_fails,
            "#!/usr/bin/env python3\n"
            "import json\n"
            "print(json.dumps({'error': 'bootstrap failed'}))\n"
            "raise SystemExit(2)\n",
        )

        completed_bootstrap_fail, payload_bootstrap_fail = run_case(
            project_root,
            bootstrap_fails,
            terminal_probe_ok,
            extra_args=["--skip-terminal-probe"],
        )
        assert completed_bootstrap_fail.returncode == 1, completed_bootstrap_fail
        assert payload_bootstrap_fail["exitCode"] == 1, payload_bootstrap_fail
        assert payload_bootstrap_fail["bootstrap"]["exitCode"] == 2, payload_bootstrap_fail
        assert payload_bootstrap_fail["terminalProbe"] is None, payload_bootstrap_fail

        terminal_probe_fails = root / "terminal_probe_fails.py"
        write_executable(
            terminal_probe_fails,
            "#!/usr/bin/env python3\n"
            "import json\n"
            "print(json.dumps({'ok': False, 'summaryJsonPath': None}))\n"
            "raise SystemExit(3)\n",
        )

        completed_probe_fail, payload_probe_fail = run_case(
            project_root,
            bootstrap_terminal_probe,
            terminal_probe_fails,
        )
        assert completed_probe_fail.returncode == 1, completed_probe_fail
        assert payload_probe_fail["exitCode"] == 1, payload_probe_fail
        assert payload_probe_fail["bootstrap"]["exitCode"] == 0, payload_probe_fail
        assert isinstance(payload_probe_fail["terminalProbe"], dict), payload_probe_fail
        assert payload_probe_fail["terminalProbe"]["exitCode"] == 3, payload_probe_fail

    print("visual_debug_start smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

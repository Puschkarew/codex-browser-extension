#!/usr/bin/env python3
"""Smoke/regression tests for visual_debug_start.py."""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import threading
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Iterator, List, Tuple


SCRIPT_PATH = Path(__file__).resolve().parent / "visual_debug_start.py"


def write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)


def run_case(
    project_root: Path,
    bootstrap_script: Path,
    terminal_probe_script: Path,
    *,
    core_base_url: str = "http://127.0.0.1:4678",
    extra_args: List[str] | None = None,
    extra_env: Dict[str, str] | None = None,
) -> Tuple[subprocess.CompletedProcess[str], Dict[str, Any]]:
    command = [
        "python3",
        str(SCRIPT_PATH),
        "--project-root",
        str(project_root),
        "--actual-app-url",
        "http://127.0.0.1:5173/",
        "--core-base-url",
        core_base_url,
        "--bootstrap-script",
        str(bootstrap_script),
        "--terminal-probe-script",
        str(terminal_probe_script),
        "--json",
    ]
    if extra_args:
        command.extend(extra_args)

    env = dict(os.environ)
    if extra_env:
        env.update(extra_env)

    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )
    payload = json.loads(completed.stdout)
    return completed, payload


def write_bootstrap_sequence(path: Path, payloads: List[Dict[str, Any]]) -> None:
    sequence_text = json.dumps(payloads, ensure_ascii=True)
    write_executable(
        path,
        "#!/usr/bin/env python3\n"
        "import json\n"
        "from pathlib import Path\n"
        f"payloads = json.loads({json.dumps(sequence_text, ensure_ascii=True)})\n"
        "counter_path = Path(__file__).with_suffix('.count')\n"
        "if counter_path.exists():\n"
        "    count = int(counter_path.read_text(encoding='utf-8').strip()) + 1\n"
        "else:\n"
        "    count = 1\n"
        "counter_path.write_text(str(count), encoding='utf-8')\n"
        "index = min(count - 1, len(payloads) - 1)\n"
        "print(json.dumps(payloads[index]))\n",
    )


@contextmanager
def mock_core_server() -> Iterator[Tuple[str, List[str]]]:
    calls: List[str] = []

    class Handler(BaseHTTPRequestHandler):
        def _write_json(self, status: int, payload: Dict[str, Any]) -> None:
            body = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:  # noqa: N802
            calls.append(f"GET {self.path}")
            if self.path == "/health":
                self._write_json(
                    200,
                    {
                        "activeSession": {
                            "sessionId": "active-session-1",
                            "state": "running",
                            "tabUrl": "http://127.0.0.1:5173/",
                        }
                    },
                )
                return
            self._write_json(404, {"error": {"message": "not found"}})

        def do_POST(self) -> None:  # noqa: N802
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {}
            calls.append(f"POST {self.path} {json.dumps(payload, ensure_ascii=True)}")

            if self.path == "/session/stop":
                self._write_json(200, {"sessionId": payload.get("sessionId"), "state": "stopped"})
                return
            if self.path == "/session/ensure":
                self._write_json(
                    200,
                    {
                        "sessionId": "ensured-session-1",
                        "state": "running",
                        "attachedTargetUrl": payload.get("tabUrl"),
                        "reused": False,
                    },
                )
                return

            self._write_json(404, {"error": {"message": "not found"}})

        def log_message(self, _format: str, *args: Any) -> None:  # noqa: ANN401
            return

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = server.server_address
        yield (f"http://{host}:{port}", calls)
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2.0)


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
            "  'outputDir': '/tmp/terminal-probe',\n"
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
            "  'readyForScenarioRun': True,\n"
            "  'readinessReasons': [],\n"
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
        assert payload["modeSelection"]["selectedMode"] == "Enhanced mode (fix-app-bugs optional addon)", payload
        assert payload["scenarioProfile"] == "baseline", payload
        assert payload["appUrlStatus"] == "match", payload
        assert payload["bootstrapConfigChanges"]["appliedRecommendations"] is False, payload
        assert payload["readiness"]["finalReady"] is True, payload
        assert payload["recovery"]["attempted"] is False, payload
        assert isinstance(payload.get("terminalProbe"), dict), payload
        assert payload["terminalProbe"]["exitCode"] == 0, payload
        assert "--tab-url-match-strategy" in payload["terminalProbe"]["command"], payload
        strategy_index = payload["terminalProbe"]["command"].index("--tab-url-match-strategy")
        assert payload["terminalProbe"]["command"][strategy_index + 1] == "origin-path", payload
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

        completed_drag_profile, payload_drag_profile = run_case(
            project_root,
            bootstrap_terminal_probe,
            terminal_probe_ok,
            extra_args=["--scenario-profile", "drag-parity", "--force-new-session", "--open-tab-if-missing"],
        )
        assert completed_drag_profile.returncode == 0, completed_drag_profile
        assert payload_drag_profile["scenarioProfile"] == "drag-parity", payload_drag_profile
        assert isinstance(payload_drag_profile.get("terminalProbe"), dict), payload_drag_profile
        command_args = payload_drag_profile["terminalProbe"]["command"]
        assert "--force-new-session" in command_args, payload_drag_profile
        assert "--open-tab-if-missing" in command_args, payload_drag_profile
        assert "--tab-url-match-strategy" in command_args, payload_drag_profile

        completed_terminal_headed, payload_terminal_headed = run_case(
            project_root,
            bootstrap_terminal_probe,
            terminal_probe_ok,
            extra_args=["--headed-evidence"],
        )
        assert completed_terminal_headed.returncode == 0, completed_terminal_headed
        assert payload_terminal_headed["headedEvidence"]["status"] == "ok", payload_terminal_headed
        assert payload_terminal_headed["headedEvidence"]["summaryJsonPath"] == "/tmp/summary.json", payload_terminal_headed

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
            "  'readyForScenarioRun': False,\n"
            "  'readinessReasons': ['app-url-gate:mismatch'],\n"
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
        assert completed_mismatch.returncode == 1, completed_mismatch
        assert payload_mismatch["exitCode"] == 1, payload_mismatch
        assert payload_mismatch["mode"] == "browser-fetch", payload_mismatch
        assert payload_mismatch["appUrlStatus"] == "mismatch", payload_mismatch
        assert payload_mismatch["terminalProbe"] is None, payload_mismatch
        assert isinstance(payload_mismatch.get("configAlignment"), dict), payload_mismatch
        assert payload_mismatch["configAlignment"]["required"] is True, payload_mismatch
        assert "apply-recommended" in payload_mismatch["configAlignment"]["applyCommand"], payload_mismatch
        assert payload_mismatch["checks"]["reasonCode"] == "APP_URL_ORIGIN_MISMATCH", payload_mismatch
        assert payload_mismatch["readiness"]["finalReady"] is False, payload_mismatch
        assert "app-url-gate:mismatch" in payload_mismatch["readiness"]["finalReasons"], payload_mismatch

        bootstrap_browser_fetch_ready = root / "bootstrap_browser_fetch_ready.py"
        write_executable(
            bootstrap_browser_fetch_ready,
            "#!/usr/bin/env python3\n"
            "import json\n"
            "print(json.dumps({\n"
            "  'browserInstrumentation': {\n"
            "    'canInstrumentFromBrowser': True,\n"
            "    'mode': 'browser-fetch',\n"
            "    'reason': None\n"
            "  },\n"
            "  'readyForScenarioRun': True,\n"
            "  'readinessReasons': [],\n"
            "  'session': {\n"
            "    'active': True,\n"
            "    'sessionId': 'session-browser-fetch-1',\n"
            "    'tabUrl': 'http://127.0.0.1:5173/',\n"
            "    'state': 'running'\n"
            "  },\n"
            "  'checks': {\n"
            "    'appUrl': {\n"
            "      'status': 'match',\n"
            "      'configAppUrl': 'http://127.0.0.1:5173/',\n"
            "      'actualAppUrl': 'http://127.0.0.1:5173/'\n"
            "    },\n"
            "    'headedEvidence': {\n"
            "      'ok': True,\n"
            "      'headlessLikely': False\n"
            "    }\n"
            "  }\n"
            "}))\n",
        )

        fake_bin_dir = root / "fake-bin"
        fake_bin_dir.mkdir(parents=True, exist_ok=True)
        fake_npm = fake_bin_dir / "npm"
        write_executable(
            fake_npm,
            "#!/usr/bin/env python3\n"
            "import json\n"
            "import os\n"
            "import sys\n"
            "if 'agent:parity-bundle' not in sys.argv:\n"
            "    print('unexpected npm command', file=sys.stderr)\n"
            "    raise SystemExit(7)\n"
            "if os.environ.get('FAKE_NPM_FAIL') == '1':\n"
            "    print(json.dumps({'error': 'forced-failure'}))\n"
            "    raise SystemExit(9)\n"
            "print(json.dumps({\n"
            "  'artifactDir': '/tmp/parity-artifacts',\n"
            "  'artifacts': {\n"
            "    'runtimeJsonPath': '/tmp/parity-artifacts/runtime.json',\n"
            "    'metricsJsonPath': '/tmp/parity-artifacts/metrics.json',\n"
            "    'summaryJsonPath': '/tmp/parity-artifacts/summary.json'\n"
            "  }\n"
            "}))\n",
        )
        env_with_fake_npm = {
            "PATH": f"{fake_bin_dir}{os.pathsep}{os.environ.get('PATH', '')}",
        }

        completed_headed_ok, payload_headed_ok = run_case(
            project_root,
            bootstrap_browser_fetch_ready,
            terminal_probe_ok,
            extra_args=["--headed-evidence", "--reference-image", "/tmp/reference.png", "--evidence-label", "delta-proof"],
            extra_env=env_with_fake_npm,
        )
        assert completed_headed_ok.returncode == 0, completed_headed_ok
        assert payload_headed_ok["headedEvidence"]["status"] == "ok", payload_headed_ok
        assert payload_headed_ok["headedEvidence"]["artifactDir"] == "/tmp/parity-artifacts", payload_headed_ok
        assert payload_headed_ok["headedEvidence"]["summaryJsonPath"] == "/tmp/parity-artifacts/summary.json", payload_headed_ok

        completed_missing_reference, payload_missing_reference = run_case(
            project_root,
            bootstrap_browser_fetch_ready,
            terminal_probe_ok,
            extra_args=["--headed-evidence"],
            extra_env=env_with_fake_npm,
        )
        assert completed_missing_reference.returncode == 1, completed_missing_reference
        assert payload_missing_reference["headedEvidence"]["status"] == "failed", payload_missing_reference
        assert "reference-image" in payload_missing_reference["headedEvidence"]["error"], payload_missing_reference

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

        recovery_false_payload = {
            "browserInstrumentation": {
                "canInstrumentFromBrowser": False,
                "mode": "terminal-probe",
                "reason": "fallback",
            },
            "readyForScenarioRun": False,
            "readinessReasons": ["cdp-unavailable:Connection refused"],
            "checks": {
                "appUrl": {
                    "status": "match",
                    "configAppUrl": "http://127.0.0.1:5173/",
                    "actualAppUrl": "http://127.0.0.1:5173/",
                }
            },
        }
        recovery_true_payload = {
            "browserInstrumentation": {
                "canInstrumentFromBrowser": False,
                "mode": "terminal-probe",
                "reason": "fallback",
            },
            "readyForScenarioRun": True,
            "readinessReasons": [],
            "checks": {
                "appUrl": {
                    "status": "match",
                    "configAppUrl": "http://127.0.0.1:5173/",
                    "actualAppUrl": "http://127.0.0.1:5173/",
                }
            },
        }

        bootstrap_recovery_success = root / "bootstrap_recovery_success.py"
        write_bootstrap_sequence(bootstrap_recovery_success, [recovery_false_payload, recovery_true_payload])
        with mock_core_server() as (core_base_url, calls):
            completed_recovery_ok, payload_recovery_ok = run_case(
                project_root,
                bootstrap_recovery_success,
                terminal_probe_ok,
                core_base_url=core_base_url,
                extra_args=["--auto-recover-session", "--skip-terminal-probe"],
            )
        assert completed_recovery_ok.returncode == 0, completed_recovery_ok
        assert payload_recovery_ok["exitCode"] == 0, payload_recovery_ok
        assert payload_recovery_ok["recovery"]["attempted"] is True, payload_recovery_ok
        assert payload_recovery_ok["recovery"]["result"] == "success", payload_recovery_ok
        assert payload_recovery_ok["readiness"]["finalReady"] is True, payload_recovery_ok
        assert any(item.startswith("GET /health") for item in calls), calls
        assert any(item.startswith("POST /session/stop") for item in calls), calls
        assert any(item.startswith("POST /session/ensure") for item in calls), calls
        assert any('"matchStrategy": "origin-path"' in item for item in calls if item.startswith("POST /session/ensure")), calls
        recovery_counter = int((bootstrap_recovery_success.with_suffix(".count")).read_text(encoding="utf-8").strip())
        assert recovery_counter == 2, recovery_counter

        bootstrap_recovery_without_flag = root / "bootstrap_recovery_without_flag.py"
        write_bootstrap_sequence(bootstrap_recovery_without_flag, [recovery_false_payload, recovery_true_payload])
        completed_no_recovery, payload_no_recovery = run_case(
            project_root,
            bootstrap_recovery_without_flag,
            terminal_probe_ok,
            extra_args=["--skip-terminal-probe"],
        )
        assert completed_no_recovery.returncode == 1, completed_no_recovery
        assert payload_no_recovery["recovery"]["attempted"] is False, payload_no_recovery
        assert payload_no_recovery["readiness"]["finalReady"] is False, payload_no_recovery
        no_recovery_counter = int((bootstrap_recovery_without_flag.with_suffix(".count")).read_text(encoding="utf-8").strip())
        assert no_recovery_counter == 1, no_recovery_counter

        bootstrap_recovery_still_blocked = root / "bootstrap_recovery_still_blocked.py"
        blocked_payload = {
            "browserInstrumentation": {
                "canInstrumentFromBrowser": False,
                "mode": "terminal-probe",
                "reason": "fallback",
            },
            "readyForScenarioRun": False,
            "readinessReasons": ["session-state:error"],
            "checks": {
                "appUrl": {
                    "status": "match",
                    "configAppUrl": "http://127.0.0.1:5173/",
                    "actualAppUrl": "http://127.0.0.1:5173/",
                }
            },
        }
        write_bootstrap_sequence(bootstrap_recovery_still_blocked, [blocked_payload, blocked_payload])
        with mock_core_server() as (core_base_url, _calls):
            completed_blocked, payload_blocked = run_case(
                project_root,
                bootstrap_recovery_still_blocked,
                terminal_probe_ok,
                core_base_url=core_base_url,
                extra_args=["--auto-recover-session"],
            )
        assert completed_blocked.returncode == 1, completed_blocked
        assert payload_blocked["recovery"]["attempted"] is True, payload_blocked
        assert payload_blocked["recovery"]["result"] == "success", payload_blocked
        assert payload_blocked["readiness"]["finalReady"] is False, payload_blocked
        assert payload_blocked["terminalProbe"] is None, payload_blocked

    print("visual_debug_start smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

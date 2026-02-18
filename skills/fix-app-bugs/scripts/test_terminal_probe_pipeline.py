#!/usr/bin/env python3
"""Smoke/regression tests for terminal_probe_pipeline.py."""

from __future__ import annotations

import base64
import json
import subprocess
import tempfile
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import unquote


SCRIPT_PATH = Path(__file__).resolve().parent / "terminal_probe_pipeline.py"


@dataclass
class FakeState:
    snapshot_path: Path
    active_session_id: Optional[str] = None
    ensure_calls: int = 0
    ensure_payloads: List[Dict[str, Any]] = field(default_factory=list)
    stop_calls: int = 0
    command_calls: List[Dict[str, Any]] = field(default_factory=list)
    force_target_not_found_once: bool = False
    cdp_tab_opened: bool = False
    cdp_opened_urls: List[str] = field(default_factory=list)
    cdp_list_targets: List[Dict[str, Any]] = field(default_factory=list)
    fail_command: Optional[str] = None
    force_compare_dimension_mismatch_once: bool = False
    compare_dimension_mismatch_emitted: bool = False
    force_navigate_once_error: bool = False
    navigate_error_emitted: bool = False


class FakeCoreHandler(BaseHTTPRequestHandler):
    @property
    def state(self) -> FakeState:
        return self.server.state  # type: ignore[attr-defined]

    def _read_json(self) -> Dict[str, Any]:
        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length).decode("utf-8")
        return json.loads(raw) if raw else {}

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/health":
            self._send_json(404, {"error": {"code": "NOT_FOUND", "message": "Unknown path"}})
            return

        active_session: Any = False
        if self.state.active_session_id:
            active_session = {
                "sessionId": self.state.active_session_id,
                "state": "running",
                "tabUrl": "http://127.0.0.1:5173/",
                "startedAt": "2026-02-17T00:00:00.000Z",
            }

        self._send_json(
            200,
            {
                "status": "ok",
                "appUrl": "http://127.0.0.1:5173/",
                "activeSession": active_session,
                "readiness": {"cdp": True, "cdpPort": 9222},
            },
        )

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/session/stop":
            payload = self._read_json()
            self.state.stop_calls += 1
            requested = payload.get("sessionId")
            if requested and requested == self.state.active_session_id:
                self.state.active_session_id = None
                self._send_json(200, {"sessionId": requested, "state": "stopped"})
                return

            self._send_json(
                404,
                {"error": {"code": "SESSION_NOT_FOUND", "message": "Session not found"}},
            )
            return

        if self.path == "/session/ensure":
            payload = self._read_json()
            self.state.ensure_calls += 1
            self.state.ensure_payloads.append(payload)

            if self.state.force_target_not_found_once:
                self.state.force_target_not_found_once = False
                self._send_json(
                    404,
                    {"error": {"code": "TARGET_NOT_FOUND", "message": "No matching tab found for tabUrl"}},
                )
                return

            self.state.active_session_id = "auto-session-id"
            self._send_json(
                200,
                {
                    "sessionId": "auto-session-id",
                    "ingestToken": "test-ingest-token",
                    "state": "running",
                    "attachedTargetUrl": "http://127.0.0.1:5173/",
                    "reused": False,
                },
            )
            return

        if self.path != "/command":
            self._send_json(404, {"error": {"code": "NOT_FOUND", "message": "Unknown path"}})
            return

        payload = self._read_json()
        self.state.command_calls.append(payload)
        command = payload.get("command")
        result: Dict[str, Any]

        if self.state.fail_command and command == self.state.fail_command:
            self._send_json(
                422,
                {
                    "ok": False,
                    "error": {
                        "code": "VALIDATION_ERROR",
                        "message": f"Invalid payload for {command}",
                        "details": {"command": command},
                    },
                },
            )
            return

        if command == "navigate" and self.state.force_navigate_once_error and not self.state.navigate_error_emitted:
            self.state.navigate_error_emitted = True
            self._send_json(
                422,
                {
                    "ok": False,
                    "error": {
                        "code": "VALIDATION_ERROR",
                        "message": "client.Page.once is not a function",
                    },
                },
            )
            return

        if command == "snapshot":
            result = {"path": str(self.state.snapshot_path)}
        elif command == "compare-reference":
            compare_payload = payload.get("payload")
            if (
                self.state.force_compare_dimension_mismatch_once
                and not self.state.compare_dimension_mismatch_emitted
                and isinstance(compare_payload, dict)
                and compare_payload.get("dimensionPolicy") == "strict"
            ):
                self.state.compare_dimension_mismatch_emitted = True
                self._send_json(
                    422,
                    {
                        "ok": False,
                        "error": {
                            "code": "IMAGE_DIMENSION_MISMATCH",
                            "message": "Image dimensions must match for comparison",
                        },
                    },
                )
                return
            result = {
                "metrics": {
                    "width": 1,
                    "height": 1,
                    "totalPixels": 1,
                    "diffPixels": 0,
                    "percentDiffPixels": 0,
                    "maeRgb": 0.1,
                    "maeLuminance": 0.05,
                    "resizeApplied": bool(
                        isinstance(compare_payload, dict)
                        and compare_payload.get("dimensionPolicy") == "resize-reference-to-actual"
                    ),
                    "originalReferenceWidth": 1,
                    "originalReferenceHeight": 1,
                },
                "artifacts": {
                    "runtimeJsonPath": "/tmp/runtime.json",
                    "metricsJsonPath": "/tmp/metrics.json",
                    "summaryJsonPath": "/tmp/summary.json",
                },
            }
        elif command in {"reload", "wait", "navigate", "evaluate", "click", "type", "webgl-diagnostics"}:
            result = {"command": command}
        else:
            self._send_json(422, {"ok": False, "error": {"code": "UNSUPPORTED", "message": "Unsupported command"}})
            return

        self._send_json(200, {"ok": True, "result": result})

    def log_message(self, _format: str, *_args: object) -> None:
        return


class FakeCdpHandler(BaseHTTPRequestHandler):
    @property
    def state(self) -> FakeState:
        return self.server.state  # type: ignore[attr-defined]

    def _handle_open_tab(self) -> None:
        prefix = "/json/new?"
        if not self.path.startswith(prefix):
            self.send_response(404)
            self.end_headers()
            return
        raw_url = self.path[len(prefix) :]
        decoded_url = unquote(raw_url)
        self.state.cdp_tab_opened = True
        self.state.cdp_opened_urls.append(decoded_url)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"id": "cdp-tab-id", "url": decoded_url}).encode("utf-8"))

    def do_PUT(self) -> None:  # noqa: N802
        self._handle_open_tab()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/json/list":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(self.state.cdp_list_targets).encode("utf-8"))
            return
        self._handle_open_tab()

    def log_message(self, _format: str, *_args: object) -> None:
        return


def write_png(path: Path) -> None:
    png_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWcAAAAASUVORK5CYII="
    path.write_bytes(base64.b64decode(png_base64))


def run_case(
    root: Path,
    state: FakeState,
    scenarios: List[Dict[str, Any]],
    extra_args: Optional[List[str]] = None,
) -> tuple[subprocess.CompletedProcess[str], Dict[str, Any], FakeState]:
    scenarios_path = root / "scenarios.json"
    scenarios_path.write_text(json.dumps(scenarios), encoding="utf-8")

    output_dir = root / "out"
    output_dir.mkdir(parents=True, exist_ok=True)

    core_server = ThreadingHTTPServer(("127.0.0.1", 0), FakeCoreHandler)
    core_server.state = state  # type: ignore[attr-defined]
    core_thread = threading.Thread(target=core_server.serve_forever, daemon=True)
    core_thread.start()

    cdp_server = ThreadingHTTPServer(("127.0.0.1", 0), FakeCdpHandler)
    cdp_server.state = state  # type: ignore[attr-defined]
    cdp_thread = threading.Thread(target=cdp_server.serve_forever, daemon=True)
    cdp_thread.start()

    try:
        core_url = f"http://127.0.0.1:{core_server.server_port}"
        command = [
            "python3",
            str(SCRIPT_PATH),
            "--project-root",
            str(root),
            "--core-base-url",
            core_url,
            "--session-id",
            "auto",
            "--tab-url",
            "http://127.0.0.1:5173/",
            "--debug-port",
            str(cdp_server.server_port),
            "--scenarios",
            str(scenarios_path),
            "--output-dir",
            str(output_dir),
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
    finally:
        core_server.shutdown()
        core_server.server_close()
        core_thread.join(timeout=2.0)
        cdp_server.shutdown()
        cdp_server.server_close()
        cdp_thread.join(timeout=2.0)

    payload = json.loads(completed.stdout) if completed.stdout.strip() else {}
    return completed, payload, state


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="terminal-probe-pipeline-") as temp_dir:
        root = Path(temp_dir)
        snapshot_path = root / "snapshot.png"
        reference_path = root / "reference.png"
        write_png(snapshot_path)
        write_png(reference_path)

        baseline_scenarios = [
            {
                "name": "scene-off",
                "commands": [
                    {"do": "reload"},
                    {"do": "wait", "ms": 200},
                    {"do": "evaluate", "expression": "window.location.href"},
                ],
                "referenceImagePath": str(reference_path),
                "fullPage": True,
            }
        ]

        baseline_state = FakeState(snapshot_path=snapshot_path)
        baseline_dir = root / "baseline"
        baseline_dir.mkdir(parents=True, exist_ok=True)
        completed, payload, observed_state = run_case(baseline_dir, baseline_state, baseline_scenarios)
        assert completed.returncode == 0, completed
        assert payload["ok"] is True, payload
        assert payload["resolvedSession"]["auto"] is True, payload
        assert payload["resolvedSession"]["resolvedSessionId"] == "auto-session-id", payload
        assert payload["modeSelection"]["executionMode"] == "terminal-probe", payload
        assert payload["scenarioCount"] == 1, payload
        runtime_path = Path(payload["runtimeJsonPath"])
        summary_path = Path(payload["summaryJsonPath"])
        assert runtime_path.exists(), payload
        assert summary_path.exists(), payload
        summary_payload = json.loads(summary_path.read_text(encoding="utf-8"))
        assert isinstance(summary_payload.get("sessionLifecycle"), dict), summary_payload
        assert observed_state.ensure_calls >= 1, observed_state
        assert observed_state.ensure_payloads[0]["matchStrategy"] == "origin-path", observed_state.ensure_payloads

        force_state = FakeState(snapshot_path=snapshot_path, active_session_id="existing-session")
        force_dir = root / "force-new-session"
        force_dir.mkdir(parents=True, exist_ok=True)
        completed_force, payload_force, observed_force = run_case(
            force_dir,
            force_state,
            baseline_scenarios,
            extra_args=["--force-new-session"],
        )
        assert completed_force.returncode == 0, completed_force
        assert payload_force["ok"] is True, payload_force
        assert observed_force.stop_calls == 1, observed_force
        lifecycle_actions = payload_force["resolvedSession"]["lifecycle"]["actions"]
        assert any(item.get("action") == "stop-active-session" for item in lifecycle_actions), payload_force

        target_missing_state = FakeState(snapshot_path=snapshot_path, force_target_not_found_once=True)
        target_missing_dir = root / "open-tab"
        target_missing_dir.mkdir(parents=True, exist_ok=True)
        completed_open_tab, payload_open_tab, observed_open_tab = run_case(
            target_missing_dir,
            target_missing_state,
            baseline_scenarios,
            extra_args=["--open-tab-if-missing"],
        )
        assert completed_open_tab.returncode == 0, completed_open_tab
        assert payload_open_tab["ok"] is True, payload_open_tab
        assert observed_open_tab.cdp_tab_opened is True, observed_open_tab
        assert observed_open_tab.ensure_calls >= 2, observed_open_tab
        assert payload_open_tab["resolvedSession"]["lifecycle"]["failureCategory"] == "target-not-found", payload_open_tab

        cdp_list_state = FakeState(
            snapshot_path=snapshot_path,
            force_target_not_found_once=True,
            cdp_list_targets=[
                {
                    "id": "target-1",
                    "type": "page",
                    "url": "http://127.0.0.1:5173/?view=grid",
                }
            ],
        )
        cdp_list_dir = root / "resolve-from-cdp-list"
        cdp_list_dir.mkdir(parents=True, exist_ok=True)
        completed_cdp_list, payload_cdp_list, observed_cdp_list = run_case(
            cdp_list_dir,
            cdp_list_state,
            baseline_scenarios,
        )
        assert completed_cdp_list.returncode == 0, completed_cdp_list
        assert payload_cdp_list["ok"] is True, payload_cdp_list
        assert observed_cdp_list.cdp_tab_opened is False, observed_cdp_list
        assert observed_cdp_list.ensure_calls >= 2, observed_cdp_list
        assert observed_cdp_list.ensure_payloads[0]["matchStrategy"] == "origin-path", observed_cdp_list.ensure_payloads
        assert observed_cdp_list.ensure_payloads[1]["matchStrategy"] == "exact", observed_cdp_list.ensure_payloads
        assert observed_cdp_list.ensure_payloads[1]["tabUrl"] == "http://127.0.0.1:5173/?view=grid", observed_cdp_list.ensure_payloads
        assert payload_cdp_list["resolvedSession"]["tabUrlMatchStrategy"] == "exact", payload_cdp_list

        resize_state = FakeState(snapshot_path=snapshot_path, force_compare_dimension_mismatch_once=True)
        resize_dir = root / "resize-fallback"
        resize_dir.mkdir(parents=True, exist_ok=True)
        completed_resize, payload_resize, _observed_resize = run_case(
            resize_dir,
            resize_state,
            baseline_scenarios,
        )
        assert completed_resize.returncode == 0, completed_resize
        assert payload_resize["ok"] is True, payload_resize
        runtime_resize = json.loads(Path(payload_resize["runtimeJsonPath"]).read_text(encoding="utf-8"))
        compare_entry = runtime_resize["scenarios"][0]["compareReference"]
        assert compare_entry["fallbackApplied"] is True, compare_entry
        assert len(compare_entry["attempts"]) == 2, compare_entry
        assert compare_entry["attempts"][0]["payload"]["dimensionPolicy"] == "strict", compare_entry
        assert compare_entry["attempts"][1]["payload"]["dimensionPolicy"] == "resize-reference-to-actual", compare_entry

        navigate_fallback_scenarios = [
            {
                "name": "navigate-fallback",
                "commands": [
                    {"do": "navigate", "url": "http://127.0.0.1:5173/feature"},
                ],
                "fullPage": True,
            }
        ]
        navigate_state = FakeState(snapshot_path=snapshot_path, force_navigate_once_error=True)
        navigate_dir = root / "navigate-fallback"
        navigate_dir.mkdir(parents=True, exist_ok=True)
        completed_navigate, payload_navigate, _observed_navigate = run_case(
            navigate_dir,
            navigate_state,
            navigate_fallback_scenarios,
        )
        assert completed_navigate.returncode == 0, completed_navigate
        assert payload_navigate["ok"] is True, payload_navigate
        runtime_navigate = json.loads(Path(payload_navigate["runtimeJsonPath"]).read_text(encoding="utf-8"))
        commands = runtime_navigate["scenarios"][0]["commands"]
        assert commands[0]["command"] == "navigate", commands
        assert commands[0]["ok"] is False, commands
        assert commands[1]["command"] == "evaluate", commands
        assert commands[1]["fallbackFor"] == "navigate", commands

        failing_scenarios = [
            {
                "name": "scene-fail",
                "commands": [{"do": "evaluate", "expression": "window.location.href"}],
                "fullPage": True,
            }
        ]
        fail_state = FakeState(snapshot_path=snapshot_path, fail_command="evaluate")
        fail_dir = root / "error-detail"
        fail_dir.mkdir(parents=True, exist_ok=True)
        completed_fail, payload_fail, _ = run_case(fail_dir, fail_state, failing_scenarios)
        assert completed_fail.returncode == 2, completed_fail
        assert payload_fail["ok"] is False, payload_fail
        runtime_fail = json.loads(Path(payload_fail["runtimeJsonPath"]).read_text(encoding="utf-8"))
        command_entry = runtime_fail["scenarios"][0]["commands"][0]
        assert command_entry["errorCode"] == "VALIDATION_ERROR", command_entry
        assert "Invalid payload for evaluate" in command_entry["errorMessage"], command_entry
        assert isinstance(command_entry["responseBodySnippet"], str) and command_entry["responseBodySnippet"], command_entry
        assert "[VALIDATION_ERROR]" in runtime_fail["scenarios"][0]["errors"][0], runtime_fail

    print("terminal_probe_pipeline smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

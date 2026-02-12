#!/usr/bin/env python3
"""Smoke/regression tests for terminal_probe_pipeline.py."""

from __future__ import annotations

import base64
import json
import subprocess
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parent / "terminal_probe_pipeline.py"


class FakeCoreHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/session/ensure":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps(
                    {
                        "sessionId": "auto-session-id",
                        "ingestToken": "test-ingest-token",
                        "state": "running",
                        "attachedTargetUrl": "http://127.0.0.1:5173/",
                        "reused": True,
                    }
                ).encode("utf-8")
            )
            return

        if self.path != "/command":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(content_length).decode("utf-8")
        payload = json.loads(raw_body)

        command = payload.get("command")
        result = {}

        if command == "snapshot":
            result = {"path": str(self.server.snapshot_path)}
        elif command == "compare-reference":
            result = {
                "metrics": {
                    "width": 1,
                    "height": 1,
                    "totalPixels": 1,
                    "diffPixels": 0,
                    "percentDiffPixels": 0,
                    "maeRgb": 0.1,
                    "maeLuminance": 0.05,
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
            self.send_response(422)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(
                json.dumps({"ok": False, "result": {}, "error": {"code": "UNSUPPORTED"}}).encode("utf-8")
            )
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True, "result": result}).encode("utf-8"))

    def log_message(self, _format: str, *_args: object) -> None:
        return


def write_png(path: Path) -> None:
    png_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlAbWcAAAAASUVORK5CYII="
    path.write_bytes(base64.b64decode(png_base64))


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="terminal-probe-pipeline-") as temp_dir:
        root = Path(temp_dir)
        snapshot_path = root / "snapshot.png"
        reference_path = root / "reference.png"
        write_png(snapshot_path)
        write_png(reference_path)

        scenarios_path = root / "scenarios.json"
        scenarios_path.write_text(
            json.dumps(
                [
                    {
                        "name": "scene-off",
                        "commands": [
                            {"do": "reload"},
                            {"do": "wait", "ms": 200},
                            {"do": "evaluate", "expression": "window.location.href"},
                        ],
                        "referenceImagePath": str(reference_path),
                        "fullPage": True,
                    },
                    {
                        "name": "scene-paused",
                        "commands": [
                            {"do": "navigate", "url": "http://127.0.0.1:5173/"},
                            {"do": "webgl-diagnostics"},
                        ],
                        "fullPage": True,
                    },
                ]
            ),
            encoding="utf-8",
        )

        output_dir = root / "out"
        server = ThreadingHTTPServer(("127.0.0.1", 0), FakeCoreHandler)
        server.snapshot_path = snapshot_path
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        try:
            core_url = f"http://127.0.0.1:{server.server_port}"
            completed = subprocess.run(
                [
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
                    "--scenarios",
                    str(scenarios_path),
                    "--output-dir",
                    str(output_dir),
                    "--json",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2.0)

        assert completed.returncode == 0, completed
        payload = json.loads(completed.stdout)
        assert payload["ok"] is True, payload
        assert payload["scenarioCount"] == 2, payload
        assert payload["resolvedSession"]["auto"] is True, payload
        assert payload["resolvedSession"]["resolvedSessionId"] == "auto-session-id", payload

        runtime_path = Path(payload["runtimeJsonPath"])
        metrics_path = Path(payload["metricsJsonPath"])
        summary_path = Path(payload["summaryJsonPath"])

        assert runtime_path.exists(), payload
        assert metrics_path.exists(), payload
        assert summary_path.exists(), payload

        metrics_payload = json.loads(metrics_path.read_text(encoding="utf-8"))
        assert metrics_payload["scenarioCount"] == 2, metrics_payload
        off_metrics = next(item for item in metrics_payload["scenarios"] if item["name"] == "scene-off")
        assert off_metrics["compareMetrics"]["maeRgb"] == 0.1, off_metrics

    print("terminal_probe_pipeline smoke checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

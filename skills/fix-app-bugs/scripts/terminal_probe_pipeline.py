#!/usr/bin/env python3
"""Scenario capture + metrics helper for terminal-probe fallback mode.

This script runs deterministic scenario commands through Browser Debug Core API,
captures snapshots, computes visual metrics, and writes a standard artifact bundle:
- runtime.json
- metrics.json
- summary.json
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_CORE_BASE_URL = "http://127.0.0.1:4678"


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_float(raw_value: str) -> Optional[float]:
    try:
        return float(raw_value.strip())
    except ValueError:
        return None


def http_json(
    method: str,
    url: str,
    payload: Optional[Dict[str, Any]] = None,
    timeout: float = 15.0,
) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        url=url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urlopen(request, timeout=timeout) as response:
            raw_body = response.read().decode("utf-8")
            parsed_body: Any
            try:
                parsed_body = json.loads(raw_body)
            except ValueError:
                parsed_body = None
            return {
                "ok": 200 <= response.status < 300,
                "status": response.status,
                "json": parsed_body,
                "body": raw_body,
            }
    except HTTPError as exc:
        raw_body = exc.read().decode("utf-8", errors="replace")
        parsed_body: Any
        try:
            parsed_body = json.loads(raw_body)
        except ValueError:
            parsed_body = None
        return {
            "ok": False,
            "status": exc.code,
            "json": parsed_body,
            "body": raw_body,
            "error": str(exc),
        }
    except (URLError, TimeoutError, ValueError) as exc:
        return {
            "ok": False,
            "status": None,
            "json": None,
            "body": "",
            "error": str(exc),
        }


def load_scenarios(path: Path) -> List[Dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Scenario file is invalid JSON: {path}: {exc}") from exc

    if not isinstance(payload, list) or not payload:
        raise RuntimeError("Scenario file must be a non-empty JSON array")

    scenarios: List[Dict[str, Any]] = []
    for index, raw in enumerate(payload):
        if not isinstance(raw, dict):
            raise RuntimeError(f"Scenario index {index} must be an object")

        name_raw = raw.get("name")
        if not isinstance(name_raw, str) or not name_raw.strip():
            raise RuntimeError(f"Scenario index {index} must have non-empty string 'name'")

        commands_raw = raw.get("commands", [])
        if not isinstance(commands_raw, list):
            raise RuntimeError(f"Scenario '{name_raw}' has invalid 'commands' (must be array)")

        reference_path = raw.get("referenceImagePath")
        if reference_path is not None and not isinstance(reference_path, str):
            raise RuntimeError(f"Scenario '{name_raw}' has invalid 'referenceImagePath' (must be string)")

        full_page = raw.get("fullPage", True)
        if not isinstance(full_page, bool):
            raise RuntimeError(f"Scenario '{name_raw}' has invalid 'fullPage' (must be boolean)")

        scenarios.append(
            {
                "name": name_raw.strip(),
                "commands": commands_raw,
                "referenceImagePath": reference_path,
                "fullPage": full_page,
            }
        )

    return scenarios


def command_payload_from_step(step: Dict[str, Any], default_timeout_ms: int) -> Tuple[str, Dict[str, Any]]:
    command = step.get("do")
    if not isinstance(command, str) or not command:
        raise RuntimeError("Scenario command step requires non-empty string 'do'")

    timeout_raw = step.get("timeoutMs", default_timeout_ms)
    timeout_ms = timeout_raw if isinstance(timeout_raw, int) and timeout_raw > 0 else default_timeout_ms

    if command == "reload":
        return command, {"waitUntil": "load", "timeoutMs": timeout_ms}

    if command == "wait":
        wait_ms_raw = step.get("ms", timeout_ms)
        wait_ms = wait_ms_raw if isinstance(wait_ms_raw, int) and wait_ms_raw > 0 else timeout_ms
        return command, {"ms": wait_ms}

    if command == "navigate":
        url = step.get("url")
        if not isinstance(url, str) or not url:
            raise RuntimeError("navigate step requires non-empty string 'url'")
        return command, {"url": url, "waitUntil": "load", "timeoutMs": timeout_ms}

    if command == "evaluate":
        expression = step.get("expression")
        if not isinstance(expression, str) or not expression.strip():
            raise RuntimeError("evaluate step requires non-empty string 'expression'")
        await_promise = step.get("awaitPromise", True)
        return_by_value = step.get("returnByValue", True)
        return command, {
            "expression": expression,
            "awaitPromise": bool(await_promise),
            "returnByValue": bool(return_by_value),
            "timeoutMs": timeout_ms,
        }

    if command == "click":
        selector = step.get("selector")
        if not isinstance(selector, str) or not selector:
            raise RuntimeError("click step requires non-empty string 'selector'")
        return command, {"selector": selector, "timeoutMs": timeout_ms}

    if command == "type":
        selector = step.get("selector")
        text = step.get("text")
        if not isinstance(selector, str) or not selector:
            raise RuntimeError("type step requires non-empty string 'selector'")
        if not isinstance(text, str):
            raise RuntimeError("type step requires string 'text'")
        clear = bool(step.get("clear", True))
        return command, {"selector": selector, "text": text, "clear": clear, "timeoutMs": timeout_ms}

    if command == "webgl-diagnostics":
        return command, {"timeoutMs": timeout_ms}

    if command == "snapshot":
        full_page = bool(step.get("fullPage", True))
        return command, {"fullPage": full_page, "timeoutMs": timeout_ms}

    raise RuntimeError(
        "Unsupported command "
        f"'{command}'. Allowed commands: reload, wait, navigate, evaluate, click, type, snapshot, webgl-diagnostics"
    )


def run_core_command(
    core_base_url: str,
    session_id: Optional[str],
    command: str,
    payload: Dict[str, Any],
    timeout_seconds: float,
) -> Dict[str, Any]:
    request_payload: Dict[str, Any] = {
        "command": command,
        "payload": payload,
    }
    if isinstance(session_id, str) and session_id:
        request_payload["sessionId"] = session_id

    response = http_json(
        "POST",
        f"{core_base_url}/command",
        payload=request_payload,
        timeout=timeout_seconds,
    )

    response_body = response.get("json")
    if not response.get("ok"):
        return {
            "ok": False,
            "status": response.get("status"),
            "error": response.get("error") or response.get("body") or "request failed",
            "response": response_body,
        }

    if not isinstance(response_body, dict):
        return {
            "ok": False,
            "status": response.get("status"),
            "error": "Core API returned non-JSON command payload",
            "response": response_body,
        }

    if not bool(response_body.get("ok")):
        return {
            "ok": False,
            "status": response.get("status"),
            "error": "Core API command failed",
            "response": response_body,
        }

    result = response_body.get("result")
    if not isinstance(result, dict):
        result = {}

    return {
        "ok": True,
        "status": response.get("status"),
        "result": result,
        "response": response_body,
    }


def ensure_session(
    core_base_url: str,
    tab_url: str,
    debug_port: int,
    reuse_active: bool,
    timeout_seconds: float,
) -> Dict[str, Any]:
    response = http_json(
        "POST",
        f"{core_base_url}/session/ensure",
        payload={
            "tabUrl": tab_url,
            "debugPort": debug_port,
            "reuseActive": reuse_active,
        },
        timeout=timeout_seconds,
    )
    body = response.get("json")
    if not response.get("ok"):
        error_code = None
        error_message = None
        if isinstance(body, dict):
            error = body.get("error")
            if isinstance(error, dict):
                error_code = error.get("code")
                error_message = error.get("message")
        raise RuntimeError(
            "session ensure failed: "
            f"status={response.get('status')} "
            f"code={error_code} message={error_message or response.get('error') or response.get('body')}"
        )

    if not isinstance(body, dict):
        raise RuntimeError("session ensure returned non-JSON payload")

    session_id = body.get("sessionId")
    if not isinstance(session_id, str) or not session_id:
        raise RuntimeError("session ensure returned invalid sessionId")

    return {
        "sessionId": session_id,
        "state": body.get("state"),
        "attachedTargetUrl": body.get("attachedTargetUrl"),
        "reused": bool(body.get("reused")),
    }


def find_magick_binary() -> Optional[str]:
    for binary in ["magick", "convert"]:
        resolved = shutil.which(binary)
        if resolved:
            return resolved
    return None


def run_magick_metric(command: List[str]) -> Dict[str, Any]:
    try:
        completed = subprocess.run(command, check=False, capture_output=True, text=True)
    except OSError as exc:
        return {"ok": False, "reason": str(exc)}

    if completed.returncode != 0:
        stderr = (completed.stderr or "").strip()
        stdout = (completed.stdout or "").strip()
        return {
            "ok": False,
            "reason": stderr or stdout or f"exit code {completed.returncode}",
        }

    return {
        "ok": True,
        "stdout": (completed.stdout or "").strip(),
    }


def compute_image_metrics(image_path: str, magick_binary: Optional[str]) -> Dict[str, Any]:
    if not magick_binary:
        return {
            "ok": False,
            "tool": None,
            "reason": "ImageMagick not found (magick/convert)",
            "mean": None,
            "stddev": None,
            "nonBlackRatio": None,
            "nonBlackPercent": None,
        }

    mean_std = run_magick_metric(
        [
            magick_binary,
            image_path,
            "-colorspace",
            "Gray",
            "-format",
            "%[fx:mean],%[fx:standard_deviation]",
            "info:",
        ]
    )
    if not mean_std.get("ok"):
        return {
            "ok": False,
            "tool": magick_binary,
            "reason": f"mean/stddev probe failed: {mean_std.get('reason')}",
            "mean": None,
            "stddev": None,
            "nonBlackRatio": None,
            "nonBlackPercent": None,
        }

    raw_mean_std = str(mean_std.get("stdout", ""))
    parts = [item.strip() for item in raw_mean_std.split(",", 1)]
    if len(parts) != 2:
        return {
            "ok": False,
            "tool": magick_binary,
            "reason": f"Unexpected mean/stddev output: {raw_mean_std}",
            "mean": None,
            "stddev": None,
            "nonBlackRatio": None,
            "nonBlackPercent": None,
        }

    mean_value = safe_float(parts[0])
    stddev_value = safe_float(parts[1])
    if mean_value is None or stddev_value is None:
        return {
            "ok": False,
            "tool": magick_binary,
            "reason": f"Unable to parse mean/stddev output: {raw_mean_std}",
            "mean": None,
            "stddev": None,
            "nonBlackRatio": None,
            "nonBlackPercent": None,
        }

    non_black = run_magick_metric(
        [
            magick_binary,
            image_path,
            "-colorspace",
            "Gray",
            "-threshold",
            "0",
            "-format",
            "%[fx:mean]",
            "info:",
        ]
    )
    if not non_black.get("ok"):
        return {
            "ok": False,
            "tool": magick_binary,
            "reason": f"nonBlackRatio probe failed: {non_black.get('reason')}",
            "mean": mean_value,
            "stddev": stddev_value,
            "nonBlackRatio": None,
            "nonBlackPercent": None,
        }

    non_black_ratio = safe_float(str(non_black.get("stdout", "")))
    if non_black_ratio is None:
        return {
            "ok": False,
            "tool": magick_binary,
            "reason": f"Unable to parse nonBlackRatio output: {non_black.get('stdout')}",
            "mean": mean_value,
            "stddev": stddev_value,
            "nonBlackRatio": None,
            "nonBlackPercent": None,
        }

    return {
        "ok": True,
        "tool": magick_binary,
        "reason": None,
        "mean": mean_value,
        "stddev": stddev_value,
        "nonBlackRatio": non_black_ratio,
        "nonBlackPercent": non_black_ratio * 100.0,
    }


def average(values: List[float]) -> Optional[float]:
    if not values:
        return None
    return sum(values) / len(values)


def extract_framebuffer_non_black_ratio(runtime_entry: Dict[str, Any]) -> Optional[float]:
    commands = runtime_entry.get("commands")
    if not isinstance(commands, list):
        return None
    for command_entry in commands:
        if not isinstance(command_entry, dict):
            continue
        if command_entry.get("command") != "webgl-diagnostics":
            continue
        command_result = command_entry.get("result")
        if not isinstance(command_result, dict):
            continue
        scene = command_result.get("scene")
        if not isinstance(scene, dict):
            continue
        non_black_ratio = scene.get("nonBlackRatio")
        if isinstance(non_black_ratio, (int, float)):
            return float(non_black_ratio)
    return None


def prepare_output_dir(project_root: Path, output_dir: Optional[str], session_id: str) -> Path:
    if output_dir:
        root = Path(output_dir).expanduser().resolve()
        root.mkdir(parents=True, exist_ok=True)
        return root

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    safe_session = (
        session_id.strip()
        .replace("/", "-")
        .replace("\\", "-")
        .replace(" ", "-")
    )
    root = (
        project_root
        / "logs"
        / "browser-debug"
        / safe_session
        / "terminal-probe"
        / timestamp
    )
    root.mkdir(parents=True, exist_ok=True)
    return root


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


def run_pipeline(
    core_base_url: str,
    session_id: str,
    scenarios: List[Dict[str, Any]],
    output_dir: Path,
    timeout_ms: int,
) -> Dict[str, Any]:
    timeout_seconds = max(timeout_ms / 1000.0, 1.0)
    magick_binary = find_magick_binary()

    runtime_scenarios: List[Dict[str, Any]] = []
    metrics_scenarios: List[Dict[str, Any]] = []
    warnings: List[str] = []
    if not magick_binary:
        warnings.append("ImageMagick not detected; mean/stddev/nonBlackRatio metrics will be null.")

    for scenario in scenarios:
        scenario_name = str(scenario["name"])
        scenario_commands = list(scenario.get("commands", []))
        reference_image_path = scenario.get("referenceImagePath")

        runtime_entry: Dict[str, Any] = {
            "name": scenario_name,
            "startedAt": iso_now(),
            "commands": [],
            "snapshot": None,
            "compareReference": None,
            "errors": [],
        }

        scenario_failed = False

        for raw_step in scenario_commands:
            if not isinstance(raw_step, dict):
                runtime_entry["errors"].append("Scenario command step must be an object")
                scenario_failed = True
                break

            try:
                command, payload = command_payload_from_step(raw_step, timeout_ms)
            except RuntimeError as exc:
                runtime_entry["errors"].append(str(exc))
                scenario_failed = True
                break

            command_result = run_core_command(core_base_url, session_id, command, payload, timeout_seconds)
            runtime_entry["commands"].append(
                {
                    "command": command,
                    "payload": payload,
                    "ok": command_result["ok"],
                    "status": command_result.get("status"),
                    "error": command_result.get("error"),
                    "result": command_result.get("result"),
                }
            )
            if not command_result["ok"]:
                scenario_failed = True
                runtime_entry["errors"].append(
                    f"Scenario command '{command}' failed: {command_result.get('error')}"
                )
                break

        snapshot_path: Optional[str] = None
        if not scenario_failed:
            snapshot_payload = {
                "fullPage": bool(scenario.get("fullPage", True)),
                "timeoutMs": timeout_ms,
            }
            snapshot_result = run_core_command(
                core_base_url,
                session_id,
                "snapshot",
                snapshot_payload,
                timeout_seconds,
            )
            runtime_entry["snapshot"] = {
                "ok": snapshot_result["ok"],
                "status": snapshot_result.get("status"),
                "error": snapshot_result.get("error"),
                "payload": snapshot_payload,
                "result": snapshot_result.get("result"),
            }
            if snapshot_result["ok"]:
                result = snapshot_result.get("result")
                if isinstance(result, dict) and isinstance(result.get("path"), str):
                    snapshot_path = result["path"]
                else:
                    scenario_failed = True
                    runtime_entry["errors"].append("Snapshot command returned no image path")
            else:
                scenario_failed = True
                runtime_entry["errors"].append(f"Snapshot failed: {snapshot_result.get('error')}")

        compare_result: Optional[Dict[str, Any]] = None
        if not scenario_failed and isinstance(reference_image_path, str) and reference_image_path.strip() and snapshot_path:
            compare_payload = {
                "actualImagePath": snapshot_path,
                "referenceImagePath": reference_image_path,
                "label": scenario_name,
                "writeDiff": True,
            }
            compare_result = run_core_command(
                core_base_url,
                session_id,
                "compare-reference",
                compare_payload,
                timeout_seconds,
            )
            runtime_entry["compareReference"] = {
                "ok": compare_result["ok"],
                "status": compare_result.get("status"),
                "error": compare_result.get("error"),
                "payload": compare_payload,
                "result": compare_result.get("result"),
            }
            if not compare_result["ok"]:
                scenario_failed = True
                runtime_entry["errors"].append(f"compare-reference failed: {compare_result.get('error')}")

        image_metrics = (
            compute_image_metrics(snapshot_path, magick_binary)
            if snapshot_path
            else {
                "ok": False,
                "tool": magick_binary,
                "reason": "Snapshot path unavailable",
                "mean": None,
                "stddev": None,
                "nonBlackRatio": None,
                "nonBlackPercent": None,
            }
        )

        compare_metrics = None
        compare_artifacts = None
        if compare_result and compare_result.get("ok"):
            compare_payload = compare_result.get("result")
            if isinstance(compare_payload, dict):
                metrics_value = compare_payload.get("metrics")
                artifacts_value = compare_payload.get("artifacts")
                if isinstance(metrics_value, dict):
                    compare_metrics = metrics_value
                if isinstance(artifacts_value, dict):
                    compare_artifacts = artifacts_value

        framebuffer_non_black_ratio = extract_framebuffer_non_black_ratio(runtime_entry)
        metrics_entry: Dict[str, Any] = {
            "name": scenario_name,
            "ok": not scenario_failed,
            "snapshotPath": snapshot_path,
            "referenceImagePath": reference_image_path,
            "imageMetrics": image_metrics,
            "framebufferNonBlackRatio": framebuffer_non_black_ratio,
            "compareMetrics": compare_metrics,
            "compareArtifacts": compare_artifacts,
            "errors": list(runtime_entry["errors"]),
        }

        runtime_entry["finishedAt"] = iso_now()
        runtime_entry["ok"] = not scenario_failed

        runtime_scenarios.append(runtime_entry)
        metrics_scenarios.append(metrics_entry)

    mean_values = [
        float(entry["imageMetrics"]["mean"])
        for entry in metrics_scenarios
        if isinstance(entry.get("imageMetrics"), dict)
        and isinstance(entry["imageMetrics"].get("mean"), (int, float))
    ]
    stddev_values = [
        float(entry["imageMetrics"]["stddev"])
        for entry in metrics_scenarios
        if isinstance(entry.get("imageMetrics"), dict)
        and isinstance(entry["imageMetrics"].get("stddev"), (int, float))
    ]
    non_black_values = [
        float(entry["imageMetrics"]["nonBlackRatio"])
        for entry in metrics_scenarios
        if isinstance(entry.get("imageMetrics"), dict)
        and isinstance(entry["imageMetrics"].get("nonBlackRatio"), (int, float))
    ]
    mae_rgb_values = [
        float(entry["compareMetrics"]["maeRgb"])
        for entry in metrics_scenarios
        if isinstance(entry.get("compareMetrics"), dict)
        and isinstance(entry["compareMetrics"].get("maeRgb"), (int, float))
    ]

    black_frame_candidates = [
        entry["name"]
        for entry in metrics_scenarios
        if isinstance(entry.get("imageMetrics"), dict)
        and isinstance(entry["imageMetrics"].get("nonBlackRatio"), (int, float))
        and float(entry["imageMetrics"]["nonBlackRatio"]) < 0.01
    ]
    framebuffer_metric_mismatches = [
        entry["name"]
        for entry in metrics_scenarios
        if isinstance(entry.get("framebufferNonBlackRatio"), (int, float))
        and isinstance(entry.get("imageMetrics"), dict)
        and isinstance(entry["imageMetrics"].get("nonBlackRatio"), (int, float))
        and float(entry["framebufferNonBlackRatio"]) < 0.01
        and float(entry["imageMetrics"]["nonBlackRatio"]) >= 0.01
    ]
    if framebuffer_metric_mismatches:
        warnings.append(
            "Detected framebuffer/screenshot mismatch in scenarios: "
            + ", ".join(framebuffer_metric_mismatches)
            + ". Use screenshot metrics + runtime exceptions as source of truth for black-screen verdict."
        )

    overall_ok = all(bool(entry.get("ok")) for entry in runtime_scenarios)

    runtime_payload = {
        "generatedAt": iso_now(),
        "mode": "terminal-probe",
        "sessionId": session_id,
        "coreBaseUrl": core_base_url,
        "scenarioCount": len(runtime_scenarios),
        "scenarios": runtime_scenarios,
        "warnings": warnings,
    }

    metrics_payload = {
        "generatedAt": iso_now(),
        "sessionId": session_id,
        "scenarioCount": len(metrics_scenarios),
        "scenarios": metrics_scenarios,
    }

    summary_payload = {
        "generatedAt": iso_now(),
        "mode": "terminal-probe",
        "sessionId": session_id,
        "ok": overall_ok,
        "scenarioCount": len(runtime_scenarios),
        "failedScenarioCount": len([entry for entry in runtime_scenarios if not bool(entry.get("ok"))]),
        "scenariosWithReference": len([entry for entry in metrics_scenarios if entry.get("compareMetrics") is not None]),
        "averages": {
            "mean": average(mean_values),
            "stddev": average(stddev_values),
            "nonBlackRatio": average(non_black_values),
            "maeRgb": average(mae_rgb_values),
        },
        "blackFrameCandidates": black_frame_candidates,
        "framebufferMetricMismatches": framebuffer_metric_mismatches,
        "warnings": warnings,
    }

    runtime_json_path = output_dir / "runtime.json"
    metrics_json_path = output_dir / "metrics.json"
    summary_json_path = output_dir / "summary.json"
    write_json(runtime_json_path, runtime_payload)
    write_json(metrics_json_path, metrics_payload)
    write_json(summary_json_path, summary_payload)

    return {
        "ok": overall_ok,
        "outputDir": str(output_dir),
        "runtimeJsonPath": str(runtime_json_path),
        "metricsJsonPath": str(metrics_json_path),
        "summaryJsonPath": str(summary_json_path),
        "warnings": warnings,
        "scenarioCount": len(runtime_scenarios),
        "failedScenarioCount": summary_payload["failedScenarioCount"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Run terminal-probe fallback scenarios via Browser Debug Core API and write "
            "runtime/metrics/summary artifacts."
        )
    )
    parser.add_argument("--project-root", default=os.getcwd(), help="Target project root (default: cwd)")
    parser.add_argument("--core-base-url", default=DEFAULT_CORE_BASE_URL, help="Core API base URL")
    parser.add_argument(
        "--session-id",
        required=True,
        help="Active Browser Debug session id, or 'auto' to resolve via /session/ensure",
    )
    parser.add_argument("--tab-url", default=None, help="Required with --session-id auto")
    parser.add_argument("--debug-port", type=int, default=9222, help="CDP port for --session-id auto")
    parser.add_argument(
        "--no-reuse-active",
        action="store_true",
        help="When using --session-id auto, do not reuse active session",
    )
    parser.add_argument("--scenarios", required=True, help="Path to scenario JSON file")
    parser.add_argument("--output-dir", default=None, help="Optional output directory for artifact bundle")
    parser.add_argument("--timeout-ms", type=int, default=15000, help="Default command timeout in milliseconds")
    parser.add_argument("--json", action="store_true", help="Print machine-readable output")

    args = parser.parse_args()

    project_root = Path(args.project_root).expanduser().resolve()
    scenarios_path = Path(args.scenarios).expanduser().resolve()
    if not scenarios_path.exists():
        print(f"terminal_probe_pipeline.py failed: scenario file does not exist: {scenarios_path}", file=sys.stderr)
        return 1

    try:
        requested_session_id = str(args.session_id).strip()
        resolved_session: Dict[str, Any] = {
            "requestedSessionId": requested_session_id,
            "resolvedSessionId": requested_session_id,
            "auto": False,
            "reused": None,
            "tabUrl": None,
        }
        if requested_session_id.lower() == "auto":
            tab_url = str(args.tab_url).strip() if isinstance(args.tab_url, str) else ""
            if not tab_url:
                print(
                    "terminal_probe_pipeline.py failed: --tab-url is required when --session-id auto",
                    file=sys.stderr,
                )
                return 1
            ensured = ensure_session(
                core_base_url=str(args.core_base_url),
                tab_url=tab_url,
                debug_port=max(int(args.debug_port), 1),
                reuse_active=not bool(args.no_reuse_active),
                timeout_seconds=max(float(args.timeout_ms) / 1000.0, 3.0),
            )
            resolved_session = {
                "requestedSessionId": requested_session_id,
                "resolvedSessionId": ensured["sessionId"],
                "auto": True,
                "reused": ensured.get("reused"),
                "tabUrl": ensured.get("attachedTargetUrl") or tab_url,
            }

        scenarios = load_scenarios(scenarios_path)
        output_dir = prepare_output_dir(project_root, args.output_dir, str(resolved_session["resolvedSessionId"]))
        result = run_pipeline(
            core_base_url=str(args.core_base_url),
            session_id=str(resolved_session["resolvedSessionId"]),
            scenarios=scenarios,
            output_dir=output_dir,
            timeout_ms=max(int(args.timeout_ms), 1000),
        )
        result["resolvedSession"] = resolved_session
    except Exception as exc:  # noqa: BLE001
        print(f"terminal_probe_pipeline.py failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, ensure_ascii=True))
    else:
        print("Terminal-probe pipeline complete")
        print(f"- ok: {result['ok']}")
        print(f"- scenarioCount: {result['scenarioCount']}")
        print(f"- failedScenarioCount: {result['failedScenarioCount']}")
        print(f"- runtimeJsonPath: {result['runtimeJsonPath']}")
        print(f"- metricsJsonPath: {result['metricsJsonPath']}")
        print(f"- summaryJsonPath: {result['summaryJsonPath']}")
        if isinstance(result.get("resolvedSession"), dict):
            print(f"- resolvedSession: {json.dumps(result['resolvedSession'], ensure_ascii=True)}")
        if result["warnings"]:
            print(f"- warnings: {json.dumps(result['warnings'], ensure_ascii=True)}")

    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())

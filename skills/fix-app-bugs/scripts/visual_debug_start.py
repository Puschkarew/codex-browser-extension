#!/usr/bin/env python3
"""Visual parity starter for fix-app-bugs workflow.

This helper composes:
1. guarded bootstrap with --actual-app-url
2. strict readiness gate checks
3. optional one-shot session/CDP auto-recovery
4. optional terminal-probe capture in fallback mode
5. optional headed parity evidence bundle generation
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


RECOVERY_TIMEOUT_SECONDS = 5.0


def as_string(value: Any) -> Optional[str]:
    if isinstance(value, str) and value.strip():
        return value
    return None


def read_json_stdout(raw_text: str) -> Optional[Dict[str, Any]]:
    try:
        parsed = json.loads(raw_text)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def run_json_command(
    command: List[str],
    *,
    cwd: Optional[str] = None,
    env: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        cwd=cwd,
        env=env,
    )
    payload = read_json_stdout(completed.stdout.strip())
    return {
        "command": command,
        "exitCode": completed.returncode,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
        "json": payload,
    }


def shell_join(args: List[str]) -> str:
    return " ".join(shlex.quote(item) for item in args)


def unique_strings(items: List[str]) -> List[str]:
    seen = set()
    result: List[str] = []
    for item in items:
        value = item.strip()
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def extract_recommended_commands(app_url_check: Dict[str, Any]) -> List[str]:
    commands: List[str] = []

    raw = app_url_check.get("recommendedCommands")
    if isinstance(raw, list):
        for item in raw:
            if isinstance(item, str):
                commands.append(item)
                continue
            if isinstance(item, dict):
                command_value = as_string(item.get("command"))
                if command_value:
                    commands.append(command_value)

    raw_text = app_url_check.get("recommendedCommandsText")
    if isinstance(raw_text, list):
        for item in raw_text:
            if isinstance(item, str):
                commands.append(item)

    primary = as_string(app_url_check.get("primaryRecommendedCommand"))
    if primary:
        commands.append(primary)

    return unique_strings(commands)


def make_starter_scenarios_file(actual_app_url: str, scenario_profile: str) -> Path:
    fd, temp_path = tempfile.mkstemp(prefix="fix-app-bugs-starter-", suffix=".json")
    os.close(fd)
    path = Path(temp_path)

    if scenario_profile == "drag-parity":
        payload = [
            {
                "name": "starter-drag-rest",
                "commands": [
                    {"do": "navigate", "url": actual_app_url},
                    {"do": "wait", "ms": 250},
                    {
                        "do": "evaluate",
                        "expression": "({ readyState: document.readyState, width: window.innerWidth, height: window.innerHeight })",
                    },
                ],
                "fullPage": True,
            },
            {
                "name": "starter-drag-active",
                "commands": [
                    {"do": "wait", "ms": 250},
                    {
                        "do": "evaluate",
                        "expression": "({ visibility: document.visibilityState, now: Date.now() })",
                    },
                ],
                "fullPage": True,
            },
        ]
    else:
        payload = [
            {
                "name": "starter-baseline",
                "commands": [{"do": "navigate", "url": actual_app_url}],
                "fullPage": True,
            }
        ]

    path.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    return path


def resolve_mode(bootstrap_payload: Dict[str, Any]) -> str:
    browser = bootstrap_payload.get("browserInstrumentation")
    if isinstance(browser, dict):
        mode_value = as_string(browser.get("mode"))
        if mode_value:
            return mode_value
        if bool(browser.get("canInstrumentFromBrowser")):
            return "browser-fetch"
    return "terminal-probe"


def normalize_readiness_reasons(raw_value: Any) -> List[str]:
    reasons: List[str] = []
    if isinstance(raw_value, list):
        for item in raw_value:
            if isinstance(item, str) and item.strip():
                reasons.append(item.strip())
    return unique_strings(reasons)


def derive_readiness(bootstrap_payload: Dict[str, Any], mode: str) -> Dict[str, Any]:
    reasons = normalize_readiness_reasons(bootstrap_payload.get("readinessReasons"))

    checks = bootstrap_payload.get("checks")
    if not isinstance(checks, dict):
        checks = {}

    app_url_check = checks.get("appUrl")
    if isinstance(app_url_check, dict):
        status_raw = app_url_check.get("status")
        status = status_raw.strip().lower() if isinstance(status_raw, str) else None
        if status in {"mismatch", "not-provided", "invalid-actual-url"}:
            reasons.append(f"app-url-gate:{status}")

    browser = bootstrap_payload.get("browserInstrumentation")
    if isinstance(browser, dict) and not bool(browser.get("canInstrumentFromBrowser")) and mode in {None, "browser-fetch"}:
        failure_category = browser.get("failureCategory")
        if isinstance(failure_category, str) and failure_category:
            reasons.append(f"instrumentation-gate:{failure_category}")
        else:
            reasons.append("instrumentation-gate:failed")

    headed_evidence_check = checks.get("headedEvidence")
    if mode == "browser-fetch" and isinstance(headed_evidence_check, dict) and not bool(headed_evidence_check.get("ok")):
        if headed_evidence_check.get("headlessLikely") is True:
            reasons.append("headed-evidence:headless")
        else:
            reasons.append("headed-evidence:unverified")

    tools = checks.get("tools")
    cdp_check = tools.get("cdp") if isinstance(tools, dict) else None
    if isinstance(cdp_check, dict) and not bool(cdp_check.get("ok")):
        cdp_reason = as_string(cdp_check.get("reason"))
        if cdp_reason:
            reasons.append(f"cdp-unavailable:{cdp_reason}")
        else:
            reasons.append("cdp-unavailable")

    core_health = checks.get("coreHealth")
    if isinstance(core_health, dict) and not bool(core_health.get("ok")):
        reasons.append("core-health-unavailable")

    session_summary = bootstrap_payload.get("session")
    if isinstance(session_summary, dict) and bool(session_summary.get("active")):
        session_state = session_summary.get("state")
        normalized_state = session_state.strip().lower() if isinstance(session_state, str) else "unknown"
        if normalized_state != "running":
            reasons.append(f"session-state:{normalized_state}")

    reasons = unique_strings(reasons)
    ready_raw = bootstrap_payload.get("readyForScenarioRun")
    if isinstance(ready_raw, bool):
        final_ready = bool(ready_raw) and len(reasons) == 0
        return {
            "finalReady": final_ready,
            "finalReasons": reasons,
        }

    return {
        "finalReady": len(reasons) == 0,
        "finalReasons": reasons,
    }


def collect_next_actions(payload: Dict[str, Any]) -> List[str]:
    actions: List[str] = []

    checks = payload.get("checks")
    app_url_status = None
    app_url_check: Dict[str, Any] = {}
    if isinstance(checks, dict):
        app = checks.get("appUrl")
        if isinstance(app, dict):
            app_url_check = app
            app_url_status = as_string(app.get("status"))
    recommended_commands = extract_recommended_commands(app_url_check)

    if app_url_status in {"mismatch", "not-provided", "invalid-actual-url"}:
        if recommended_commands:
            actions.append(f"Run recommended command: {recommended_commands[0]}")
        else:
            actions.append("Resolve app URL mismatch before instrumentation and re-run bootstrap_guarded.")

    return actions


def extract_bootstrap_context(bootstrap_payload: Optional[Dict[str, Any]], fallback_actual_app_url: str) -> Dict[str, Any]:
    payload = bootstrap_payload if isinstance(bootstrap_payload, dict) else {}
    mode = resolve_mode(payload)

    checks = payload.get("checks")
    checks = checks if isinstance(checks, dict) else {}

    app_url_status = None
    app_url_reason_code = None
    config_app_url = None
    actual_app_url = fallback_actual_app_url
    app_url_check: Dict[str, Any] = {}
    app_value = checks.get("appUrl")
    if isinstance(app_value, dict):
        app_url_check = app_value
        app_url_status = as_string(app_value.get("status"))
        app_url_reason_code = as_string(app_value.get("reasonCode"))
        config_app_url = as_string(app_value.get("configAppUrl"))
        actual_app_url = as_string(app_value.get("actualAppUrl")) or fallback_actual_app_url

    session_value = payload.get("session")
    session_id = None
    if isinstance(session_value, dict):
        session_id = as_string(session_value.get("sessionId"))

    readiness = derive_readiness(payload, mode)
    plugin_root = as_string(payload.get("pluginRoot"))
    return {
        "mode": mode,
        "pluginRoot": plugin_root,
        "checks": checks,
        "appUrlStatus": app_url_status,
        "appUrlReasonCode": app_url_reason_code,
        "configAppUrl": config_app_url,
        "actualAppUrl": actual_app_url,
        "appUrlCheck": app_url_check,
        "recommendedCommands": extract_recommended_commands(app_url_check),
        "sessionId": session_id,
        "readiness": readiness,
    }


def http_json(
    method: str,
    url: str,
    payload: Optional[Dict[str, Any]] = None,
    timeout_seconds: float = RECOVERY_TIMEOUT_SECONDS,
) -> Dict[str, Any]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        url=url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            raw_body = response.read().decode("utf-8", errors="replace")
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
                "error": None,
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


def summarize_error(response: Dict[str, Any]) -> str:
    payload = response.get("json")
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = as_string(error.get("message"))
            if message:
                return message
        top_level = as_string(payload.get("message"))
        if top_level:
            return top_level
    body = as_string(response.get("body"))
    if body:
        return body[:300]
    error = as_string(response.get("error"))
    if error:
        return error
    return "request failed"


def should_attempt_recovery(auto_recover_session: bool, readiness_reasons: List[str]) -> bool:
    if not auto_recover_session:
        return False
    for reason in readiness_reasons:
        if reason.startswith("cdp-unavailable:") or reason.startswith("cdp-unavailable"):
            return True
        if reason.startswith("session-state:"):
            return True
    return False


def attempt_session_recovery(
    core_base_url: str,
    tab_url: str,
    debug_port: int,
) -> Dict[str, Any]:
    actions: List[Dict[str, Any]] = []

    health_response = http_json("GET", f"{core_base_url}/health")
    actions.append(
        {
            "action": "health-check",
            "ok": bool(health_response.get("ok")),
            "status": health_response.get("status"),
            "error": None if health_response.get("ok") else summarize_error(health_response),
        }
    )
    if not bool(health_response.get("ok")):
        return {
            "attempted": True,
            "actions": actions,
            "result": "failed",
            "reason": "health-check-failed",
        }

    active_session_id = None
    health_json = health_response.get("json")
    if isinstance(health_json, dict):
        active = health_json.get("activeSession")
        if isinstance(active, dict):
            active_session_id = as_string(active.get("sessionId"))

    if active_session_id:
        stop_response = http_json(
            "POST",
            f"{core_base_url}/session/stop",
            payload={"sessionId": active_session_id},
        )
        actions.append(
            {
                "action": "stop-active-session",
                "sessionId": active_session_id,
                "ok": bool(stop_response.get("ok")),
                "status": stop_response.get("status"),
                "error": None if stop_response.get("ok") else summarize_error(stop_response),
            }
        )
        if not bool(stop_response.get("ok")):
            return {
                "attempted": True,
                "actions": actions,
                "result": "failed",
                "reason": "session-stop-failed",
            }
    else:
        actions.append(
            {
                "action": "stop-active-session",
                "ok": True,
                "status": None,
                "skipped": True,
                "reason": "no-active-session",
            }
        )

    ensure_response = http_json(
        "POST",
        f"{core_base_url}/session/ensure",
        payload={
            "tabUrl": tab_url,
            "debugPort": max(int(debug_port), 1),
            "reuseActive": False,
        },
    )
    ensure_json = ensure_response.get("json")
    ensured_session_id = None
    if isinstance(ensure_json, dict):
        ensured_session_id = as_string(ensure_json.get("sessionId"))
    actions.append(
        {
            "action": "ensure-session",
            "ok": bool(ensure_response.get("ok")),
            "status": ensure_response.get("status"),
            "sessionId": ensured_session_id,
            "error": None if ensure_response.get("ok") else summarize_error(ensure_response),
        }
    )
    if not bool(ensure_response.get("ok")):
        return {
            "attempted": True,
            "actions": actions,
            "result": "failed",
            "reason": "session-ensure-failed",
        }

    return {
        "attempted": True,
        "actions": actions,
        "result": "success",
        "reason": None,
        "sessionId": ensured_session_id,
    }


def run_terminal_probe_capture(
    script_path: Path,
    project_root: str,
    core_base_url: str,
    session_id: str,
    tab_url: str,
    debug_port: int,
    scenarios_path: Path,
    output_dir: Optional[str],
    force_new_session: bool,
    open_tab_if_missing: bool,
) -> Dict[str, Any]:
    command = [
        "python3",
        str(script_path),
        "--project-root",
        project_root,
        "--core-base-url",
        core_base_url,
        "--session-id",
        session_id,
        "--tab-url",
        tab_url,
        "--debug-port",
        str(debug_port),
        "--scenarios",
        str(scenarios_path),
        "--json",
    ]
    if force_new_session:
        command.append("--force-new-session")
    if open_tab_if_missing:
        command.append("--open-tab-if-missing")
    if output_dir:
        command.extend(["--output-dir", output_dir])
    return run_json_command(command)


def run_headed_evidence_bundle(
    command_cwd: str,
    core_base_url: str,
    reference_image: str,
    evidence_label: str,
    session_id: Optional[str],
) -> Dict[str, Any]:
    command = [
        "npm",
        "run",
        "agent:parity-bundle",
        "--",
        "--reference",
        reference_image,
        "--label",
        evidence_label,
    ]
    if session_id:
        command.extend(["--session", session_id])

    env = dict(os.environ)
    parsed_core_url = urlparse(core_base_url)
    if parsed_core_url.port:
        env["CORE_PORT"] = str(parsed_core_url.port)

    return run_json_command(command, cwd=command_cwd, env=env)


def build_headed_evidence_from_parity(result: Dict[str, Any]) -> Dict[str, Any]:
    payload = result.get("json")
    if not isinstance(payload, dict):
        error = as_string(result.get("stderr")) or as_string(result.get("stdout")) or "Parity bundle returned invalid JSON"
        return {
            "status": "failed",
            "artifactDir": None,
            "runtimeJsonPath": None,
            "metricsJsonPath": None,
            "summaryJsonPath": None,
            "error": error,
        }

    artifacts = payload.get("artifacts")
    artifacts = artifacts if isinstance(artifacts, dict) else {}

    status = "ok" if result.get("exitCode") == 0 else "failed"
    error = None if status == "ok" else (as_string(result.get("stderr")) or as_string(result.get("stdout")) or "Parity bundle failed")

    return {
        "status": status,
        "artifactDir": as_string(payload.get("artifactDir")),
        "runtimeJsonPath": as_string(artifacts.get("runtimeJsonPath")),
        "metricsJsonPath": as_string(artifacts.get("metricsJsonPath")),
        "summaryJsonPath": as_string(artifacts.get("summaryJsonPath")),
        "error": error,
    }


def build_headed_evidence_from_terminal_probe(terminal_probe_result: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(terminal_probe_result, dict):
        return {
            "status": "failed",
            "artifactDir": None,
            "runtimeJsonPath": None,
            "metricsJsonPath": None,
            "summaryJsonPath": None,
            "error": "terminal-probe bundle is unavailable",
        }

    payload = terminal_probe_result.get("json")
    payload = payload if isinstance(payload, dict) else {}
    status = "ok" if terminal_probe_result.get("exitCode") == 0 else "failed"
    error = None if status == "ok" else (
        as_string(terminal_probe_result.get("stderr"))
        or as_string(terminal_probe_result.get("stdout"))
        or "terminal-probe capture failed"
    )

    return {
        "status": status,
        "artifactDir": as_string(payload.get("outputDir")),
        "runtimeJsonPath": as_string(payload.get("runtimeJsonPath")),
        "metricsJsonPath": as_string(payload.get("metricsJsonPath")),
        "summaryJsonPath": as_string(payload.get("summaryJsonPath")),
        "error": error,
    }


def compute_exit_code(
    bootstrap: Dict[str, Any],
    terminal_probe_result: Optional[Dict[str, Any]],
    readiness: Dict[str, Any],
    recovery: Dict[str, Any],
    headed_evidence: Dict[str, Any],
    plan_mode: bool,
) -> int:
    bootstrap_exit = bootstrap.get("exitCode")
    if isinstance(bootstrap_exit, int) and bootstrap_exit != 0:
        return 1

    if bool(recovery.get("attempted")) and recovery.get("result") == "failed":
        return 1

    if not plan_mode and not bool(readiness.get("finalReady")):
        return 1

    if isinstance(terminal_probe_result, dict):
        probe_exit = terminal_probe_result.get("exitCode")
        if isinstance(probe_exit, int) and probe_exit != 0:
            return 1

    if headed_evidence.get("status") == "failed":
        return 1

    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Visual debug starter helper for fix-app-bugs")
    parser.add_argument("--project-root", default=os.getcwd(), help="Target project root (default: cwd)")
    parser.add_argument("--actual-app-url", required=True, help="Actual app URL used in reproduction")
    parser.add_argument("--apply-recommended", action="store_true", help="Pass through to bootstrap_guarded")
    parser.add_argument("--core-base-url", default="http://127.0.0.1:4678", help="Core API base URL")
    parser.add_argument("--session-id", default="auto", help="Session id for terminal-probe pipeline")
    parser.add_argument("--debug-port", type=int, default=9222, help="CDP debug port for auto session resolve")
    parser.add_argument(
        "--scenario-profile",
        choices=["baseline", "drag-parity"],
        default="baseline",
        help="Built-in scenario profile used when --scenarios is omitted",
    )
    parser.add_argument("--scenarios", default=None, help="Optional scenario file for terminal-probe pipeline")
    parser.add_argument("--output-dir", default=None, help="Optional output directory for terminal-probe bundle")
    parser.add_argument(
        "--force-new-session",
        action="store_true",
        help="Pass --force-new-session to terminal_probe_pipeline when capture runs",
    )
    parser.add_argument(
        "--open-tab-if-missing",
        action="store_true",
        help="Pass --open-tab-if-missing to terminal_probe_pipeline when capture runs",
    )
    parser.add_argument(
        "--auto-recover-session",
        action="store_true",
        help="If readiness fails on CDP/session reasons, perform one stop+ensure recovery attempt and rerun bootstrap",
    )
    parser.add_argument(
        "--headed-evidence",
        action="store_true",
        help="Generate headed evidence bundle (browser-fetch uses parity-bundle; terminal-probe reuses capture bundle)",
    )
    parser.add_argument(
        "--reference-image",
        default=None,
        help="Reference image path for --headed-evidence in browser-fetch mode",
    )
    parser.add_argument(
        "--evidence-label",
        default="visual-debug-start",
        help="Label for headed evidence parity bundle",
    )
    parser.add_argument("--skip-terminal-probe", action="store_true", help="Skip terminal-probe capture step")
    parser.add_argument("--plan-mode", action="store_true", help="Preview config alignment commands without running terminal-probe")
    parser.add_argument("--bootstrap-script", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--terminal-probe-script", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--json", action="store_true", help="Print machine-readable output")
    args = parser.parse_args()

    project_root = str(Path(args.project_root).expanduser().resolve())
    script_dir = Path(__file__).resolve().parent
    bootstrap_script = (
        Path(args.bootstrap_script).expanduser().resolve()
        if args.bootstrap_script
        else (script_dir / "bootstrap_guarded.py")
    )
    terminal_probe_script = (
        Path(args.terminal_probe_script).expanduser().resolve()
        if args.terminal_probe_script
        else (script_dir / "terminal_probe_pipeline.py")
    )

    bootstrap_cmd = [
        "python3",
        str(bootstrap_script),
        "--project-root",
        project_root,
        "--actual-app-url",
        args.actual_app_url,
        "--json",
    ]
    if args.apply_recommended:
        bootstrap_cmd.insert(-1, "--apply-recommended")

    bootstrap = run_json_command(bootstrap_cmd)
    bootstrap_payload = bootstrap.get("json")
    context = extract_bootstrap_context(bootstrap_payload, args.actual_app_url)

    recovery: Dict[str, Any] = {
        "attempted": False,
        "actions": [],
        "result": "not-attempted",
        "reason": None,
    }
    if should_attempt_recovery(bool(args.auto_recover_session), list(context["readiness"]["finalReasons"])):
        recovery = attempt_session_recovery(
            core_base_url=str(args.core_base_url),
            tab_url=str(context["actualAppUrl"]),
            debug_port=int(args.debug_port),
        )
        if recovery.get("result") == "success":
            bootstrap = run_json_command(bootstrap_cmd)
            bootstrap_payload = bootstrap.get("json")
            context = extract_bootstrap_context(bootstrap_payload, args.actual_app_url)

    mode = str(context["mode"])
    app_url_status = context["appUrlStatus"]
    app_url_reason_code = context["appUrlReasonCode"]
    config_app_url = context["configAppUrl"]
    actual_app_url = str(context["actualAppUrl"])
    app_url_check = context["appUrlCheck"]
    readiness = context["readiness"]
    final_ready = bool(readiness["finalReady"])
    final_reasons = list(readiness["finalReasons"])

    next_actions = collect_next_actions(bootstrap_payload if isinstance(bootstrap_payload, dict) else {})
    if recovery.get("attempted"):
        if recovery.get("result") == "success":
            next_actions.append("Session/CDP recovery attempt succeeded; bootstrap was re-run.")
        else:
            next_actions.append("Session/CDP recovery attempt failed; inspect recovery.actions for details.")

    recommended_commands = context["recommendedCommands"]
    resume_command_args = [
        "python3",
        str(Path(__file__).resolve()),
        "--project-root",
        project_root,
        "--actual-app-url",
        actual_app_url,
        "--scenario-profile",
        args.scenario_profile,
        "--json",
    ]
    if args.force_new_session:
        resume_command_args.append("--force-new-session")
    if args.open_tab_if_missing:
        resume_command_args.append("--open-tab-if-missing")
    if args.auto_recover_session:
        resume_command_args.append("--auto-recover-session")
    if args.headed_evidence:
        resume_command_args.append("--headed-evidence")
    if args.reference_image:
        resume_command_args.extend(["--reference-image", str(args.reference_image)])
    if as_string(args.evidence_label):
        resume_command_args.extend(["--evidence-label", str(args.evidence_label)])
    resume_command = shell_join(resume_command_args)
    preview_command = shell_join(
        [
            "python3",
            str(bootstrap_script),
            "--project-root",
            project_root,
            "--actual-app-url",
            actual_app_url,
            "--json",
        ]
    )
    default_apply_command = shell_join(
        [
            "python3",
            str(bootstrap_script),
            "--project-root",
            project_root,
            "--actual-app-url",
            actual_app_url,
            "--apply-recommended",
            "--json",
        ]
    )
    apply_command = recommended_commands[0] if recommended_commands else default_apply_command
    config_alignment: Optional[Dict[str, Any]] = None
    if app_url_status in {"mismatch", "not-provided", "invalid-actual-url"}:
        config_alignment = {
            "required": True,
            "status": app_url_status,
            "reasonCode": app_url_reason_code,
            "previewCommand": preview_command,
            "applyCommand": apply_command,
            "resumeCommand": resume_command,
        }
        if args.plan_mode:
            next_actions.append("Plan mode enabled: preview config alignment commands before applying changes.")
        next_actions.append(f"Preview config fix: {preview_command}")
        next_actions.append(f"Apply config fix: {apply_command}")
        next_actions.append(f"Resume visual starter: {resume_command}")

    terminal_probe_result: Optional[Dict[str, Any]] = None
    scenarios_temp_path: Optional[Path] = None

    can_run_terminal_probe = (
        mode == "terminal-probe"
        and not args.skip_terminal_probe
        and not args.plan_mode
        and final_ready
    )

    if mode == "terminal-probe" and not final_ready and not args.plan_mode:
        next_actions.append(
            "Scenario launch blocked by readiness gate: "
            + ", ".join(final_reasons if final_reasons else ["unknown-reason"])
        )

    if can_run_terminal_probe:
        if args.scenarios:
            scenarios_path = Path(args.scenarios).expanduser().resolve()
        else:
            scenarios_temp_path = make_starter_scenarios_file(actual_app_url, args.scenario_profile)
            scenarios_path = scenarios_temp_path

        terminal_probe_result = run_terminal_probe_capture(
            script_path=terminal_probe_script,
            project_root=project_root,
            core_base_url=args.core_base_url,
            session_id=str(args.session_id),
            tab_url=actual_app_url,
            debug_port=int(args.debug_port),
            scenarios_path=scenarios_path,
            output_dir=args.output_dir,
            force_new_session=bool(args.force_new_session),
            open_tab_if_missing=bool(args.open_tab_if_missing),
        )

        probe_payload = terminal_probe_result.get("json")
        if isinstance(probe_payload, dict) and as_string(probe_payload.get("summaryJsonPath")):
            next_actions.append(f"Review summary: {probe_payload['summaryJsonPath']}")
        else:
            next_actions.append("Terminal-probe capture did not return summaryJsonPath; inspect stderr and rerun.")

    if mode == "terminal-probe" and not args.scenarios:
        next_actions.append(f"Built-in scenario profile in use: {args.scenario_profile}")

    headed_evidence: Dict[str, Any] = {
        "status": "not-requested",
        "artifactDir": None,
        "runtimeJsonPath": None,
        "metricsJsonPath": None,
        "summaryJsonPath": None,
        "error": None,
    }
    if args.headed_evidence:
        if mode == "browser-fetch":
            if not as_string(args.reference_image):
                headed_evidence = {
                    "status": "failed",
                    "artifactDir": None,
                    "runtimeJsonPath": None,
                    "metricsJsonPath": None,
                    "summaryJsonPath": None,
                    "error": "--reference-image is required when --headed-evidence is used in browser-fetch mode",
                }
            elif not final_ready and not args.plan_mode:
                headed_evidence = {
                    "status": "failed",
                    "artifactDir": None,
                    "runtimeJsonPath": None,
                    "metricsJsonPath": None,
                    "summaryJsonPath": None,
                    "error": "Readiness gate is not satisfied; headed evidence run blocked",
                }
            else:
                parity_bundle = run_headed_evidence_bundle(
                    command_cwd=str(context.get("pluginRoot") or project_root),
                    core_base_url=str(args.core_base_url),
                    reference_image=str(args.reference_image),
                    evidence_label=str(args.evidence_label),
                    session_id=context["sessionId"],
                )
                headed_evidence = build_headed_evidence_from_parity(parity_bundle)
                if headed_evidence.get("status") == "ok" and as_string(headed_evidence.get("summaryJsonPath")):
                    next_actions.append(f"Review headed evidence summary: {headed_evidence['summaryJsonPath']}")
                elif headed_evidence.get("status") == "failed":
                    next_actions.append("Headed evidence run failed; inspect headedEvidence.error and parity bundle stderr.")
        elif mode == "terminal-probe":
            headed_evidence = build_headed_evidence_from_terminal_probe(terminal_probe_result)
            if headed_evidence.get("status") == "ok" and as_string(headed_evidence.get("summaryJsonPath")):
                next_actions.append(f"Headed evidence uses terminal-probe bundle: {headed_evidence['summaryJsonPath']}")
            elif headed_evidence.get("status") == "failed":
                next_actions.append("Headed evidence requested, but terminal-probe bundle is unavailable.")

    if mode == "browser-fetch" and not args.headed_evidence:
        next_actions.append(
            "Run parity bundle: npm run agent:parity-bundle -- --session <id> --reference /path/ref.png --label baseline"
        )
    elif mode == "terminal-probe" and args.plan_mode:
        next_actions.append("Plan mode: terminal-probe capture skipped. Run without --plan-mode to capture runtime artifacts.")
    elif mode == "terminal-probe" and args.skip_terminal_probe:
        next_actions.append("Run terminal-probe scenarios manually when ready.")

    next_actions = unique_strings(next_actions)

    exit_code = compute_exit_code(
        bootstrap=bootstrap,
        terminal_probe_result=terminal_probe_result,
        readiness=readiness,
        recovery=recovery,
        headed_evidence=headed_evidence,
        plan_mode=bool(args.plan_mode),
    )

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "mode": mode,
        "exitCode": exit_code,
        "scenarioProfile": args.scenario_profile,
        "appUrlStatus": app_url_status,
        "checks": {
            "configAppUrl": config_app_url,
            "actualAppUrl": actual_app_url,
            "reasonCode": app_url_reason_code,
        },
        "bootstrap": bootstrap,
        "configAlignment": config_alignment,
        "recovery": recovery,
        "readiness": readiness,
        "terminalProbe": terminal_probe_result,
        "headedEvidence": headed_evidence,
        "nextActions": next_actions,
    }

    if args.json:
        print(json.dumps(output, ensure_ascii=True))
    else:
        print("Visual debug starter")
        print(f"- mode: {mode}")
        print(f"- checks.appUrl.status: {app_url_status}")
        print(f"- checks.appUrl.reasonCode: {app_url_reason_code}")
        print(f"- checks.appUrl.configAppUrl: {config_app_url}")
        print(f"- checks.appUrl.actualAppUrl: {actual_app_url}")
        print(f"- readiness.finalReady: {readiness['finalReady']}")
        print(f"- readiness.finalReasons: {json.dumps(readiness['finalReasons'], ensure_ascii=True)}")
        print(f"- recovery.result: {recovery.get('result')}")
        if terminal_probe_result is not None:
            print(f"- terminalProbe.exitCode: {terminal_probe_result.get('exitCode')}")
        print(f"- headedEvidence.status: {headed_evidence.get('status')}")
        for action in next_actions:
            print(f"- next: {action}")
        print(json.dumps(output, ensure_ascii=True))

    if scenarios_temp_path and scenarios_temp_path.exists():
        scenarios_temp_path.unlink(missing_ok=True)

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

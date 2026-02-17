#!/usr/bin/env python3
"""Visual parity starter for fix-app-bugs workflow.

This helper composes:
1. guarded bootstrap with --actual-app-url
2. app-url status checks
3. optional minimal terminal-probe capture when mode is terminal-probe
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


def run_json_command(command: List[str]) -> Dict[str, Any]:
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
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


def make_minimal_scenarios_file(actual_app_url: str) -> Path:
    fd, temp_path = tempfile.mkstemp(prefix="fix-app-bugs-starter-", suffix=".json")
    os.close(fd)
    path = Path(temp_path)
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

    if app_url_status in {"mismatch", "not-provided"}:
        if recommended_commands:
            actions.append(f"Run recommended command: {recommended_commands[0]}")
        else:
            actions.append("Resolve app URL mismatch before instrumentation and re-run bootstrap_guarded.")

    return actions


def run_terminal_probe_capture(
    script_path: Path,
    project_root: str,
    core_base_url: str,
    session_id: str,
    tab_url: str,
    debug_port: int,
    scenarios_path: Path,
    output_dir: Optional[str],
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
    if output_dir:
        command.extend(["--output-dir", output_dir])
    return run_json_command(command)


def compute_exit_code(
    bootstrap: Dict[str, Any],
    terminal_probe_result: Optional[Dict[str, Any]],
) -> int:
    bootstrap_exit = bootstrap.get("exitCode")
    if isinstance(bootstrap_exit, int) and bootstrap_exit != 0:
        return 1

    if isinstance(terminal_probe_result, dict):
        probe_exit = terminal_probe_result.get("exitCode")
        if isinstance(probe_exit, int) and probe_exit != 0:
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
    parser.add_argument("--scenarios", default=None, help="Optional scenario file for terminal-probe pipeline")
    parser.add_argument("--output-dir", default=None, help="Optional output directory for terminal-probe bundle")
    parser.add_argument("--skip-terminal-probe", action="store_true", help="Skip terminal-probe capture step")
    parser.add_argument("--plan-mode", action="store_true", help="Preview config alignment commands without running terminal-probe")
    parser.add_argument("--bootstrap-script", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--terminal-probe-script", default=None, help=argparse.SUPPRESS)
    parser.add_argument("--json", action="store_true", help="Print machine-readable output")
    args = parser.parse_args()

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
        str(Path(args.project_root).expanduser().resolve()),
        "--actual-app-url",
        args.actual_app_url,
        "--json",
    ]
    if args.apply_recommended:
        bootstrap_cmd.insert(-1, "--apply-recommended")

    bootstrap = run_json_command(bootstrap_cmd)
    bootstrap_payload = bootstrap.get("json")
    mode = resolve_mode(bootstrap_payload or {})
    next_actions = collect_next_actions(bootstrap_payload or {})

    checks = bootstrap_payload.get("checks") if isinstance(bootstrap_payload, dict) else {}
    app_url_status = None
    app_url_reason_code = None
    config_app_url = None
    actual_app_url = args.actual_app_url
    app_url_check: Dict[str, Any] = {}
    if isinstance(checks, dict):
        app = checks.get("appUrl")
        if isinstance(app, dict):
            app_url_check = app
            app_url_status = as_string(app.get("status"))
            app_url_reason_code = as_string(app.get("reasonCode"))
            config_app_url = as_string(app.get("configAppUrl"))
            actual_app_url = as_string(app.get("actualAppUrl")) or args.actual_app_url

    recommended_commands = extract_recommended_commands(app_url_check)
    resume_command = shell_join(
        [
            "python3",
            str(Path(__file__).resolve()),
            "--project-root",
            str(Path(args.project_root).expanduser().resolve()),
            "--actual-app-url",
            actual_app_url,
            "--json",
        ]
    )
    preview_command = shell_join(
        [
            "python3",
            str(bootstrap_script),
            "--project-root",
            str(Path(args.project_root).expanduser().resolve()),
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
            str(Path(args.project_root).expanduser().resolve()),
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
    scenarios_path: Optional[Path] = None
    scenarios_temp_path: Optional[Path] = None

    can_run_terminal_probe = (
        mode == "terminal-probe"
        and not args.skip_terminal_probe
        and not args.plan_mode
        and app_url_status not in {"mismatch", "not-provided", "invalid-actual-url"}
    )

    if can_run_terminal_probe:
        if args.scenarios:
            scenarios_path = Path(args.scenarios).expanduser().resolve()
        else:
            scenarios_temp_path = make_minimal_scenarios_file(actual_app_url)
            scenarios_path = scenarios_temp_path

        terminal_probe_result = run_terminal_probe_capture(
            script_path=terminal_probe_script,
            project_root=str(Path(args.project_root).expanduser().resolve()),
            core_base_url=args.core_base_url,
            session_id=str(args.session_id),
            tab_url=actual_app_url,
            debug_port=int(args.debug_port),
            scenarios_path=scenarios_path,
            output_dir=args.output_dir,
        )

        probe_payload = terminal_probe_result.get("json")
        if isinstance(probe_payload, dict) and as_string(probe_payload.get("summaryJsonPath")):
            next_actions.append(f"Review summary: {probe_payload['summaryJsonPath']}")
        else:
            next_actions.append("Terminal-probe capture did not return summaryJsonPath; inspect stderr and rerun.")

    if mode == "browser-fetch":
        next_actions.append("Run parity bundle: npm run agent:parity-bundle -- --session <id> --reference /path/ref.png --label baseline")
    elif mode == "terminal-probe" and args.plan_mode:
        next_actions.append("Plan mode: terminal-probe capture skipped. Run without --plan-mode to capture runtime artifacts.")
    elif mode == "terminal-probe" and args.skip_terminal_probe:
        next_actions.append("Run terminal-probe scenarios manually when ready.")

    next_actions = unique_strings(next_actions)

    exit_code = compute_exit_code(bootstrap=bootstrap, terminal_probe_result=terminal_probe_result)

    output = {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "mode": mode,
        "exitCode": exit_code,
        "appUrlStatus": app_url_status,
        "checks": {
            "configAppUrl": config_app_url,
            "actualAppUrl": actual_app_url,
            "reasonCode": app_url_reason_code,
        },
        "bootstrap": bootstrap,
        "configAlignment": config_alignment,
        "terminalProbe": terminal_probe_result,
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
        if terminal_probe_result is not None:
            print(f"- terminalProbe.exitCode: {terminal_probe_result.get('exitCode')}")
        for action in next_actions:
            print(f"- next: {action}")
        print(json.dumps(output, ensure_ascii=True))

    if scenarios_temp_path and scenarios_temp_path.exists():
        scenarios_temp_path.unlink(missing_ok=True)

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

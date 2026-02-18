#!/usr/bin/env python3
"""Guarded bootstrap wrapper for fix-app-bugs skill.

This wrapper never falsely reports active browser instrumentation.
If the underlying bootstrap script is unavailable or fails, it returns a
machine-readable terminal-probe fallback payload and exits 0.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional


def unique_paths(paths: List[Path]) -> List[Path]:
    seen = set()
    result: List[Path] = []
    for path in paths:
        key = str(path.resolve()) if path.exists() else str(path)
        if key in seen:
            continue
        seen.add(key)
        result.append(path)
    return result


def resolve_bootstrap_candidates(override: Optional[str]) -> List[Path]:
    script_dir = Path(__file__).resolve().parent
    codex_home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))).expanduser()

    if override:
        # Explicit override is treated as authoritative (used by tests/custom setups).
        return [Path(override).expanduser()]

    candidates: List[Path] = []
    candidates.extend(
        [
            script_dir / "bootstrap_browser_debug.py",
            codex_home / "skills" / "fix-app-bugs" / "scripts" / "bootstrap_browser_debug.py",
            Path.home() / ".codex" / "skills" / "fix-app-bugs" / "scripts" / "bootstrap_browser_debug.py",
        ]
    )
    return unique_paths(candidates)


def fallback_payload(project_root: str, reason: str, script_path: Optional[Path]) -> Dict[str, Any]:
    fallback_reason = reason.strip() if isinstance(reason, str) else ""
    readiness_reason = "bootstrap-fallback"
    if fallback_reason:
        snippet = fallback_reason[:180]
        readiness_reason = f"bootstrap-fallback:{snippet}"
    return {
        "pluginRoot": None,
        "projectConfigPath": str(Path(project_root).expanduser().resolve() / ".codex" / "browser-debug.json"),
        "appUrl": None,
        "coreBaseUrl": None,
        "debugEndpoint": None,
        "queryEndpoint": None,
        "cdpPort": None,
        "session": {
            "active": False,
            "sessionId": None,
            "tabUrl": None,
            "state": None,
        },
        "checks": {},
        "browserInstrumentation": {
            "canInstrumentFromBrowser": False,
            "mode": "terminal-probe",
            "reason": reason,
            "readyForScenarioRun": False,
        },
        "readyForScenarioRun": False,
        "readinessReasons": [readiness_reason],
        "recommendations": [],
        "recommendedDiff": "",
        "appliedRecommendations": False,
        "bootstrap": {
            "status": "fallback",
            "reason": reason,
            "scriptPath": str(script_path) if script_path else None,
        },
    }


def enrich_success_payload(payload: Dict[str, Any], script_path: Path) -> Dict[str, Any]:
    result = dict(payload)
    browser = result.get("browserInstrumentation")
    if not isinstance(browser, dict):
        browser = {}
    can_instrument = bool(browser.get("canInstrumentFromBrowser"))
    mode = browser.get("mode")
    if not isinstance(mode, str) or not mode:
        mode = "browser-fetch" if can_instrument else "terminal-probe"
    reason = browser.get("reason")
    if reason is not None and not isinstance(reason, str):
        reason = str(reason)
    browser["canInstrumentFromBrowser"] = can_instrument
    browser["mode"] = mode
    browser["reason"] = reason
    result["browserInstrumentation"] = browser

    session = result.get("session")
    if not isinstance(session, dict):
        session = {}
    session["active"] = bool(session.get("active"))
    session["sessionId"] = session.get("sessionId") if isinstance(session.get("sessionId"), str) else None
    session["tabUrl"] = session.get("tabUrl") if isinstance(session.get("tabUrl"), str) else None
    session["state"] = session.get("state") if isinstance(session.get("state"), str) else None
    result["session"] = session

    readiness_reasons_raw = result.get("readinessReasons")
    readiness_reasons: List[str] = []
    if isinstance(readiness_reasons_raw, list):
        for item in readiness_reasons_raw:
            if isinstance(item, str) and item.strip():
                readiness_reasons.append(item.strip())

    ready_from_payload = result.get("readyForScenarioRun")
    ready_for_scenario: bool
    if isinstance(ready_from_payload, bool):
        ready_for_scenario = ready_from_payload
    else:
        mode_value = mode.strip().lower() if isinstance(mode, str) else None
        if not readiness_reasons and not can_instrument and mode_value in {None, "browser-fetch"}:
            failure_category = browser.get("failureCategory")
            if isinstance(failure_category, str) and failure_category:
                readiness_reasons.append(f"instrumentation-gate:{failure_category}")
            else:
                readiness_reasons.append("instrumentation-gate:failed")
        if bool(session.get("active")):
            session_state = session.get("state")
            normalized_state = session_state.strip().lower() if isinstance(session_state, str) else "unknown"
            if normalized_state != "running":
                readiness_reasons.append(f"session-state:{normalized_state}")
        ready_for_scenario = len(readiness_reasons) == 0

    result["readyForScenarioRun"] = ready_for_scenario
    result["readinessReasons"] = readiness_reasons
    browser["readyForScenarioRun"] = ready_for_scenario

    result["bootstrap"] = {
        "status": "ok",
        "reason": None,
        "scriptPath": str(script_path),
    }
    return result


def run_bootstrap(
    script_path: Path,
    project_root: str,
    actual_app_url: Optional[str],
    apply_recommended: bool,
) -> Dict[str, Any]:
    cmd: List[str] = [sys.executable, str(script_path), "--project-root", project_root, "--json"]
    if actual_app_url:
        cmd.extend(["--actual-app-url", actual_app_url])
    if apply_recommended:
        cmd.append("--apply-recommended")

    try:
        completed = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError as exc:
        return fallback_payload(project_root, f"bootstrap launch failed: {exc}", script_path)

    if completed.returncode != 0:
        stderr = completed.stderr.strip()
        reason = (
            f"bootstrap returned non-zero exit code {completed.returncode}: {stderr}"
            if stderr
            else f"bootstrap returned non-zero exit code {completed.returncode}"
        )
        return fallback_payload(project_root, reason, script_path)

    stdout = completed.stdout.strip()
    if not stdout:
        return fallback_payload(project_root, "bootstrap produced empty stdout", script_path)

    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError as exc:
        return fallback_payload(project_root, f"bootstrap emitted invalid JSON: {exc}", script_path)

    if not isinstance(payload, dict):
        return fallback_payload(project_root, "bootstrap JSON payload is not an object", script_path)

    return enrich_success_payload(payload, script_path)


def bootstrap_guarded(
    project_root: str,
    actual_app_url: Optional[str],
    apply_recommended: bool,
    bootstrap_script: Optional[str],
) -> Dict[str, Any]:
    candidates = resolve_bootstrap_candidates(bootstrap_script)
    selected: Optional[Path] = None
    for candidate in candidates:
        if candidate.exists():
            selected = candidate
            break

    if selected is None:
        reason = f"bootstrap script not found in candidates: {', '.join(str(path) for path in candidates)}"
        return fallback_payload(project_root, reason, candidates[0] if candidates else None)

    return run_bootstrap(selected, project_root, actual_app_url, apply_recommended)


def main() -> int:
    parser = argparse.ArgumentParser(description="Guarded bootstrap wrapper for fix-app-bugs skill")
    parser.add_argument("--project-root", default=os.getcwd(), help="Target project root (default: cwd)")
    parser.add_argument("--actual-app-url", default=None, help="Actual app URL used during reproduction")
    parser.add_argument(
        "--apply-recommended",
        action="store_true",
        help="Apply recommended config updates in the underlying bootstrap script",
    )
    parser.add_argument(
        "--bootstrap-script",
        default=None,
        help="Override path to bootstrap_browser_debug.py (for testing/custom setups)",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON output")
    args = parser.parse_args()

    payload = bootstrap_guarded(
        project_root=str(Path(args.project_root).expanduser().resolve()),
        actual_app_url=args.actual_app_url,
        apply_recommended=bool(args.apply_recommended),
        bootstrap_script=args.bootstrap_script,
    )

    if args.json:
        print(json.dumps(payload, ensure_ascii=True))
    else:
        bootstrap_meta = payload.get("bootstrap", {})
        browser = payload.get("browserInstrumentation", {})
        print("Guarded Browser Debug bootstrap")
        print(f"- bootstrap.status: {bootstrap_meta.get('status')}")
        print(f"- bootstrap.reason: {bootstrap_meta.get('reason')}")
        print(f"- browserInstrumentation.mode: {browser.get('mode')}")
        print(
            f"- browserInstrumentation.canInstrumentFromBrowser: "
            f"{browser.get('canInstrumentFromBrowser')}"
        )
        print(json.dumps(payload, ensure_ascii=True))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

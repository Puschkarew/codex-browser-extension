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
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

DEFAULT_CORE_BASE_URL = "http://127.0.0.1:4678"
BODY_SNIPPET_LIMIT = 600
SESSION_ENSURE_RETRY_LIMIT = 3
DEFAULT_TAB_URL_MATCH_STRATEGY = "origin-path"
DEFAULT_RESIZE_INTERPOLATION = "bilinear"

PIPELINE_RETRY_BASE_COMMAND = (
    "python3 \"${CODEX_HOME:-$HOME/.codex}/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py\" "
    "--project-root <project-root> --session-id auto --tab-url <url> "
    "--tab-url-match-strategy origin-path --scenarios <scenarios.json> --json"
)
PIPELINE_RETRY_FORCE_RECOVERY_COMMAND = f"{PIPELINE_RETRY_BASE_COMMAND} --force-new-session --open-tab-if-missing"
PIPELINE_RETRY_EXACT_COMMAND = f"{PIPELINE_RETRY_BASE_COMMAND} --tab-url-match-strategy exact --no-open-tab-if-missing"
PIPELINE_RETRY_TIMEOUT_COMMAND = f"{PIPELINE_RETRY_FORCE_RECOVERY_COMMAND} --timeout-ms 30000"
SESSION_START_COMMAND = "npm run agent:session -- --tab-url <url> --match-strategy origin-path"
SESSION_RESTART_COMMAND = f"npm run agent:stop && {SESSION_START_COMMAND}"
VISUAL_START_RECOVERY_COMMAND = (
    "python3 \"${CODEX_HOME:-$HOME/.codex}/skills/fix-app-bugs/scripts/visual_debug_start.py\" "
    "--project-root <project-root> --actual-app-url <url> --auto-recover-session --json"
)
STALE_TRANSPORT_HINTS = [
    "websocket",
    "readystate 3",
    "closed",
    "target closed",
    "session closed",
    "cdp client is not attached",
    "socket hang up",
    "econnreset",
]


class SessionEnsureError(RuntimeError):
    def __init__(
        self,
        status: Optional[int],
        error_code: Optional[str],
        error_message: str,
        response_body_snippet: Optional[str],
    ) -> None:
        super().__init__(error_message)
        self.status = status
        self.error_code = error_code
        self.error_message = error_message
        self.response_body_snippet = response_body_snippet


class AutoSessionResolutionError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        failure_category: Optional[str] = None,
        error_code: Optional[str] = None,
        lifecycle: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.failure_category = failure_category
        self.error_code = error_code
        self.lifecycle = lifecycle


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def safe_float(raw_value: str) -> Optional[float]:
    try:
        return float(raw_value.strip())
    except ValueError:
        return None


def sanitize_body_snippet(raw_value: Any, limit: int = BODY_SNIPPET_LIMIT) -> Optional[str]:
    if raw_value is None:
        return None

    if isinstance(raw_value, (dict, list)):
        text = json.dumps(raw_value, ensure_ascii=True)
    else:
        text = str(raw_value)

    text = text.replace("\n", " ").replace("\r", " ")
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return None

    text = re.sub(
        r'(?i)("?(?:token|secret|password|authorization|cookie)"?\s*:\s*")[^"]*(")',
        r"\1<redacted>\2",
        text,
    )
    text = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9\-._~+/]+=*", r"\1<redacted>", text)

    if len(text) <= limit:
        return text
    return text[: limit - 3] + "..."


def extract_error_fields(response_body: Any) -> Dict[str, Any]:
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    error_details: Any = None

    if isinstance(response_body, dict):
        error_object = response_body.get("error")
        if isinstance(error_object, dict):
            raw_code = error_object.get("code")
            raw_message = error_object.get("message")
            if isinstance(raw_code, str) and raw_code:
                error_code = raw_code
            if isinstance(raw_message, str) and raw_message:
                error_message = raw_message
            if "details" in error_object:
                error_details = error_object.get("details")
        if error_message is None:
            top_level_message = response_body.get("message")
            if isinstance(top_level_message, str) and top_level_message:
                error_message = top_level_message

    return {
        "errorCode": error_code,
        "errorMessage": error_message,
        "errorDetails": error_details,
    }


def parse_url_parts(raw_url: str) -> Optional[Dict[str, Any]]:
    try:
        parsed = urlparse(raw_url)
    except ValueError:
        return None

    if not parsed.scheme or not parsed.hostname:
        return None

    scheme = parsed.scheme.lower()
    hostname = parsed.hostname.lower()
    try:
        port = parsed.port if parsed.port is not None else (443 if scheme == "https" else 80)
    except ValueError:
        return None

    return {
        "scheme": scheme,
        "hostname": hostname,
        "port": port,
        "origin": f"{scheme}://{hostname}:{port}",
        "path": parsed.path or "/",
    }


def urls_match(candidate_url: str, requested_url: str, match_strategy: str) -> bool:
    if match_strategy == "exact":
        return candidate_url == requested_url

    candidate = parse_url_parts(candidate_url)
    requested = parse_url_parts(requested_url)
    if not isinstance(candidate, dict) or not isinstance(requested, dict):
        return False

    if match_strategy == "origin-path":
        return candidate["origin"] == requested["origin"] and candidate["path"] == requested["path"]

    if match_strategy == "origin":
        return candidate["origin"] == requested["origin"]

    return False


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
    snippet = sanitize_body_snippet(response_body if response_body is not None else response.get("body"))
    error_fields = extract_error_fields(response_body)
    if not response.get("ok"):
        error_message = (
            error_fields.get("errorMessage")
            or response.get("error")
            or snippet
            or "request failed"
        )
        return {
            "ok": False,
            "status": response.get("status"),
            "error": error_message,
            "errorCode": error_fields.get("errorCode"),
            "errorMessage": error_fields.get("errorMessage"),
            "errorDetails": error_fields.get("errorDetails"),
            "responseBodySnippet": snippet,
            "response": response_body,
        }

    if not isinstance(response_body, dict):
        return {
            "ok": False,
            "status": response.get("status"),
            "error": "Core API returned non-JSON command payload",
            "errorCode": None,
            "errorMessage": None,
            "errorDetails": None,
            "responseBodySnippet": snippet,
            "response": response_body,
        }

    if not bool(response_body.get("ok")):
        error_message = error_fields.get("errorMessage") or "Core API command failed"
        return {
            "ok": False,
            "status": response.get("status"),
            "error": error_message,
            "errorCode": error_fields.get("errorCode"),
            "errorMessage": error_fields.get("errorMessage"),
            "errorDetails": error_fields.get("errorDetails"),
            "responseBodySnippet": snippet,
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
    match_strategy: str,
    timeout_seconds: float,
) -> Dict[str, Any]:
    response = http_json(
        "POST",
        f"{core_base_url}/session/ensure",
        payload={
            "tabUrl": tab_url,
            "debugPort": debug_port,
            "reuseActive": reuse_active,
            "matchStrategy": match_strategy,
        },
        timeout=timeout_seconds,
    )
    body = response.get("json")
    if not response.get("ok"):
        error_fields = extract_error_fields(body)
        snippet = sanitize_body_snippet(body if body is not None else response.get("body"))
        message = (
            error_fields.get("errorMessage")
            or response.get("error")
            or snippet
            or "request failed"
        )
        raise SessionEnsureError(
            status=response.get("status"),
            error_code=error_fields.get("errorCode"),
            error_message=message,
            response_body_snippet=snippet,
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


def get_active_session_id(core_base_url: str, timeout_seconds: float) -> Optional[str]:
    response = http_json(
        "GET",
        f"{core_base_url}/health",
        timeout=timeout_seconds,
    )
    body = response.get("json")
    if not response.get("ok") or not isinstance(body, dict):
        return None
    active = body.get("activeSession")
    if not isinstance(active, dict):
        return None
    session_id = active.get("sessionId")
    if isinstance(session_id, str) and session_id:
        return session_id
    return None


def stop_session(core_base_url: str, session_id: str, timeout_seconds: float) -> Dict[str, Any]:
    response = http_json(
        "POST",
        f"{core_base_url}/session/stop",
        payload={"sessionId": session_id},
        timeout=timeout_seconds,
    )
    body = response.get("json")
    snippet = sanitize_body_snippet(body if body is not None else response.get("body"))
    error_fields = extract_error_fields(body)
    if response.get("ok"):
        return {
            "ok": True,
            "status": response.get("status"),
            "responseBodySnippet": snippet,
        }

    return {
        "ok": False,
        "status": response.get("status"),
        "errorCode": error_fields.get("errorCode"),
        "errorMessage": error_fields.get("errorMessage") or response.get("error") or snippet,
        "responseBodySnippet": snippet,
    }


def list_tabs_via_cdp(debug_port: int, timeout_seconds: float) -> Dict[str, Any]:
    endpoint = f"http://127.0.0.1:{debug_port}/json/list"
    request = Request(endpoint, method="GET")
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            raw_body = response.read().decode("utf-8", errors="replace")
            try:
                parsed_body = json.loads(raw_body)
            except ValueError:
                parsed_body = None

            if not isinstance(parsed_body, list):
                return {
                    "ok": False,
                    "status": response.status,
                    "endpoint": endpoint,
                    "errorCode": "INVALID_CDP_LIST_RESPONSE",
                    "errorMessage": "CDP /json/list did not return an array",
                    "responseBodySnippet": sanitize_body_snippet(raw_body),
                    "targets": [],
                }

            targets = [
                {
                    "id": item.get("id"),
                    "url": item.get("url"),
                    "type": item.get("type"),
                }
                for item in parsed_body
                if isinstance(item, dict)
            ]
            page_targets = [
                {
                    "id": str(item.get("id")) if item.get("id") is not None else None,
                    "url": str(item.get("url")) if isinstance(item.get("url"), str) else None,
                    "type": item.get("type"),
                }
                for item in targets
                if item.get("type") == "page" and isinstance(item.get("url"), str)
            ]
            return {
                "ok": True,
                "status": response.status,
                "endpoint": endpoint,
                "targets": page_targets,
                "responseBodySnippet": sanitize_body_snippet(raw_body),
            }
    except HTTPError as exc:
        raw_body = exc.read().decode("utf-8", errors="replace")
        return {
            "ok": False,
            "status": exc.code,
            "endpoint": endpoint,
            "errorCode": "CDP_LIST_HTTP_ERROR",
            "errorMessage": str(exc),
            "responseBodySnippet": sanitize_body_snippet(raw_body),
            "targets": [],
        }
    except (URLError, TimeoutError, ValueError) as exc:
        return {
            "ok": False,
            "status": None,
            "endpoint": endpoint,
            "errorCode": "CDP_LIST_UNAVAILABLE",
            "errorMessage": str(exc),
            "responseBodySnippet": None,
            "targets": [],
        }


def resolve_exact_tab_url_via_cdp(
    tab_url: str,
    debug_port: int,
    match_strategy: str,
    timeout_seconds: float,
) -> Dict[str, Any]:
    listed = list_tabs_via_cdp(debug_port, timeout_seconds)
    if not listed.get("ok"):
        return {
            "ok": False,
            "errorCode": listed.get("errorCode"),
            "errorMessage": listed.get("errorMessage"),
            "status": listed.get("status"),
            "endpoint": listed.get("endpoint"),
            "responseBodySnippet": listed.get("responseBodySnippet"),
            "matchCount": 0,
            "candidates": [],
            "resolvedTabUrl": None,
        }

    targets = listed.get("targets", [])
    if not isinstance(targets, list):
        targets = []

    matched_targets = []
    for item in targets:
        if not isinstance(item, dict):
            continue
        url_value = item.get("url")
        if not isinstance(url_value, str):
            continue
        if urls_match(url_value, tab_url, match_strategy):
            matched_targets.append(
                {
                    "id": item.get("id"),
                    "url": url_value,
                }
            )

    if len(matched_targets) == 0:
        return {
            "ok": False,
            "errorCode": "TARGET_NOT_FOUND",
            "errorMessage": "No matching tab found in CDP /json/list",
            "status": listed.get("status"),
            "endpoint": listed.get("endpoint"),
            "responseBodySnippet": listed.get("responseBodySnippet"),
            "matchCount": 0,
            "candidates": [],
            "resolvedTabUrl": None,
        }

    if len(matched_targets) > 1:
        return {
            "ok": False,
            "errorCode": "AMBIGUOUS_TARGET",
            "errorMessage": "Multiple tabs matched the requested URL",
            "status": listed.get("status"),
            "endpoint": listed.get("endpoint"),
            "responseBodySnippet": listed.get("responseBodySnippet"),
            "matchCount": len(matched_targets),
            "candidates": matched_targets,
            "resolvedTabUrl": None,
        }

    resolved = matched_targets[0]
    return {
        "ok": True,
        "errorCode": None,
        "errorMessage": None,
        "status": listed.get("status"),
        "endpoint": listed.get("endpoint"),
        "responseBodySnippet": listed.get("responseBodySnippet"),
        "matchCount": 1,
        "candidates": matched_targets,
        "resolvedTabUrl": resolved.get("url"),
        "targetId": resolved.get("id"),
    }


def open_tab_via_cdp(tab_url: str, debug_port: int, timeout_seconds: float) -> Dict[str, Any]:
    encoded_url = quote(tab_url, safe="")
    endpoint = f"http://127.0.0.1:{debug_port}/json/new?{encoded_url}"
    methods = ["PUT", "GET"]
    last_failure: Optional[Dict[str, Any]] = None

    for method in methods:
        request = Request(endpoint, method=method)
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                raw_body = response.read().decode("utf-8", errors="replace")
                parsed_body: Any
                try:
                    parsed_body = json.loads(raw_body)
                except ValueError:
                    parsed_body = None

                target_id = parsed_body.get("id") if isinstance(parsed_body, dict) else None
                target_url = parsed_body.get("url") if isinstance(parsed_body, dict) else None
                return {
                    "ok": True,
                    "status": response.status,
                    "method": method,
                    "endpoint": endpoint,
                    "targetId": target_id,
                    "targetUrl": target_url,
                    "responseBodySnippet": sanitize_body_snippet(raw_body),
                }
        except HTTPError as exc:
            raw_body = exc.read().decode("utf-8", errors="replace")
            last_failure = {
                "ok": False,
                "status": exc.code,
                "method": method,
                "endpoint": endpoint,
                "errorMessage": str(exc),
                "responseBodySnippet": sanitize_body_snippet(raw_body),
            }
            if exc.code not in {404, 405}:
                break
        except (URLError, TimeoutError, ValueError) as exc:
            last_failure = {
                "ok": False,
                "status": None,
                "method": method,
                "endpoint": endpoint,
                "errorMessage": str(exc),
                "responseBodySnippet": None,
            }
            break

    return last_failure or {
        "ok": False,
        "status": None,
        "method": None,
        "endpoint": endpoint,
        "errorMessage": "Unable to open tab via CDP",
        "responseBodySnippet": None,
    }


def classify_session_failure(error: SessionEnsureError) -> str:
    if error.error_code == "TARGET_NOT_FOUND":
        return "target-not-found"
    if error.error_code == "CDP_UNAVAILABLE" or error.status == 503:
        return "cdp-unavailable"
    if error.error_code == "SESSION_ALREADY_RUNNING" or error.status == 409:
        return "session-already-running"
    if error.status == 422:
        return "validation-error"
    return "session-ensure-failed"


def resolve_auto_session(
    core_base_url: str,
    tab_url: str,
    debug_port: int,
    reuse_active: bool,
    force_new_session: bool,
    open_tab_if_missing: bool,
    tab_url_match_strategy: str,
    timeout_seconds: float,
) -> Dict[str, Any]:
    lifecycle: Dict[str, Any] = {
        "forceNewSession": force_new_session,
        "openTabIfMissing": open_tab_if_missing,
        "tabUrlMatchStrategy": tab_url_match_strategy,
        "failureCategory": None,
        "ensureAttempts": 0,
        "firstEnsureAttemptSucceeded": False,
        "fallbackUsed": False,
        "fallbackActionsUsed": [],
        "attachBranch": "direct-ensure",
        "actions": [],
    }

    if force_new_session:
        active_session_id = get_active_session_id(core_base_url, timeout_seconds)
        if active_session_id:
            stop_result = stop_session(core_base_url, active_session_id, timeout_seconds)
            lifecycle["actions"].append(
                {
                    "action": "stop-active-session",
                    "sessionId": active_session_id,
                    **stop_result,
                }
            )
            if not bool(stop_result.get("ok")):
                lifecycle["failureCategory"] = "session-stop-failed"
                raise AutoSessionResolutionError(
                    (
                        "force-new-session failed: "
                        f"status={stop_result.get('status')} "
                        f"code={stop_result.get('errorCode')} "
                        f"message={stop_result.get('errorMessage')}"
                    ),
                    failure_category="session-stop-failed",
                    error_code=(
                        str(stop_result.get("errorCode"))
                        if isinstance(stop_result.get("errorCode"), str)
                        else None
                    ),
                    lifecycle=lifecycle,
                )
        else:
            lifecycle["actions"].append(
                {
                    "action": "stop-active-session",
                    "ok": True,
                    "status": None,
                    "skipped": True,
                    "reason": "no-active-session",
                }
            )
        reuse_active = False

    opened_tab_for_target_recovery = False
    resolved_exact_tab_url = False
    fallback_actions_used: List[str] = []
    attach_branch = "direct-ensure"
    current_tab_url = tab_url

    # Preflight: when a unique target is already visible in CDP list, bind to exact URL
    # before the first /session/ensure to reduce first-attempt TARGET_NOT_FOUND churn.
    if tab_url_match_strategy != "exact":
        preflight_resolved_tab = resolve_exact_tab_url_via_cdp(
            tab_url=current_tab_url,
            debug_port=debug_port,
            match_strategy=tab_url_match_strategy,
            timeout_seconds=timeout_seconds,
        )
        lifecycle["actions"].append(
            {
                "action": "preflight-resolve-target-from-cdp-list",
                **preflight_resolved_tab,
            }
        )
        if bool(preflight_resolved_tab.get("ok")) and isinstance(preflight_resolved_tab.get("resolvedTabUrl"), str):
            current_tab_url = str(preflight_resolved_tab["resolvedTabUrl"])
            tab_url_match_strategy = "exact"
            resolved_exact_tab_url = True
            attach_branch = "preflight-resolve-target-from-cdp-list"
            if "preflight-resolve-target-from-cdp-list" not in fallback_actions_used:
                fallback_actions_used.append("preflight-resolve-target-from-cdp-list")
            lifecycle["fallbackUsed"] = True

    for attempt in range(1, SESSION_ENSURE_RETRY_LIMIT + 1):
        lifecycle["ensureAttempts"] = attempt
        try:
            ensured = ensure_session(
                core_base_url=core_base_url,
                tab_url=current_tab_url,
                debug_port=debug_port,
                reuse_active=reuse_active,
                match_strategy=tab_url_match_strategy,
                timeout_seconds=timeout_seconds,
            )
            lifecycle["actions"].append(
                {
                    "action": "ensure-session",
                    "attempt": attempt,
                    "ok": True,
                    "status": 200,
                    "reused": ensured.get("reused"),
                    "sessionId": ensured.get("sessionId"),
                    "attachedTargetUrl": ensured.get("attachedTargetUrl"),
                    "tabUrl": current_tab_url,
                    "matchStrategy": tab_url_match_strategy,
                }
            )
            lifecycle["firstEnsureAttemptSucceeded"] = attempt == 1
            lifecycle["fallbackUsed"] = bool(fallback_actions_used)
            lifecycle["fallbackActionsUsed"] = list(fallback_actions_used)
            lifecycle["attachBranch"] = attach_branch
            return {
                "ensured": ensured,
                "lifecycle": lifecycle,
                "resolvedTabUrl": current_tab_url,
                "tabUrlMatchStrategy": tab_url_match_strategy,
            }
        except SessionEnsureError as exc:
            failure_category = classify_session_failure(exc)
            lifecycle["failureCategory"] = failure_category
            lifecycle["actions"].append(
                {
                    "action": "ensure-session",
                    "attempt": attempt,
                    "ok": False,
                    "status": exc.status,
                    "errorCode": exc.error_code,
                    "errorMessage": exc.error_message,
                    "responseBodySnippet": exc.response_body_snippet,
                    "failureCategory": failure_category,
                    "tabUrl": current_tab_url,
                    "matchStrategy": tab_url_match_strategy,
                }
            )

            if failure_category == "target-not-found" and not resolved_exact_tab_url:
                resolved_tab = resolve_exact_tab_url_via_cdp(
                    tab_url=current_tab_url,
                    debug_port=debug_port,
                    match_strategy=tab_url_match_strategy,
                    timeout_seconds=timeout_seconds,
                )
                lifecycle["actions"].append(
                    {
                        "action": "resolve-target-from-cdp-list",
                        **resolved_tab,
                    }
                )
                if bool(resolved_tab.get("ok")) and isinstance(resolved_tab.get("resolvedTabUrl"), str):
                    current_tab_url = str(resolved_tab["resolvedTabUrl"])
                    tab_url_match_strategy = "exact"
                    resolved_exact_tab_url = True
                    attach_branch = "resolve-target-from-cdp-list"
                    if "resolve-target-from-cdp-list" not in fallback_actions_used:
                        fallback_actions_used.append("resolve-target-from-cdp-list")
                    lifecycle["fallbackUsed"] = True
                    continue
                if resolved_tab.get("errorCode") == "AMBIGUOUS_TARGET":
                    lifecycle["failureCategory"] = "ambiguous-target"
                    raise AutoSessionResolutionError(
                        (
                            "session ensure failed: "
                            f"status={exc.status} "
                            f"code=AMBIGUOUS_TARGET "
                            f"message={resolved_tab.get('errorMessage')}"
                        ),
                        failure_category="ambiguous-target",
                        error_code="AMBIGUOUS_TARGET",
                        lifecycle=lifecycle,
                    ) from exc

            if (
                open_tab_if_missing
                and not opened_tab_for_target_recovery
                and failure_category == "target-not-found"
            ):
                open_tab_result = open_tab_via_cdp(current_tab_url, debug_port, timeout_seconds)
                lifecycle["actions"].append(
                    {
                        "action": "open-tab-if-missing",
                        **open_tab_result,
                    }
                )
                if bool(open_tab_result.get("ok")):
                    opened_tab_for_target_recovery = True
                    attach_branch = "open-tab-if-missing"
                    if "open-tab-if-missing" not in fallback_actions_used:
                        fallback_actions_used.append("open-tab-if-missing")
                    lifecycle["fallbackUsed"] = True
                    continue
                raise AutoSessionResolutionError(
                    (
                        "open-tab-if-missing failed: "
                        f"status={open_tab_result.get('status')} "
                        f"message={open_tab_result.get('errorMessage')}"
                    ),
                    failure_category="open-tab-failed",
                    error_code=(
                        str(open_tab_result.get("errorCode"))
                        if isinstance(open_tab_result.get("errorCode"), str)
                        else None
                    ),
                    lifecycle=lifecycle,
                )

            if failure_category == "cdp-unavailable" and attempt < SESSION_ENSURE_RETRY_LIMIT:
                backoff_seconds = round(0.4 * attempt, 2)
                lifecycle["actions"].append(
                    {
                        "action": "retry-after-backoff",
                        "attempt": attempt,
                        "ok": True,
                        "reason": "cdp-unavailable",
                        "seconds": backoff_seconds,
                    }
                )
                attach_branch = "retry-after-backoff"
                if "retry-after-backoff" not in fallback_actions_used:
                    fallback_actions_used.append("retry-after-backoff")
                lifecycle["fallbackUsed"] = True
                time.sleep(backoff_seconds)
                continue

            raise AutoSessionResolutionError(
                (
                    "session ensure failed: "
                    f"status={exc.status} "
                    f"code={exc.error_code} "
                    f"message={exc.error_message}"
                ),
                failure_category=failure_category,
                error_code=exc.error_code,
                lifecycle=lifecycle,
            ) from exc

    raise AutoSessionResolutionError(
        "session ensure failed: retry limit exceeded",
        failure_category=(
            str(lifecycle.get("failureCategory"))
            if isinstance(lifecycle.get("failureCategory"), str)
            else None
        ),
        lifecycle=lifecycle,
    )


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


def should_retry_navigate_with_evaluate(command_result: Dict[str, Any]) -> bool:
    if command_result.get("ok"):
        return False
    error_text = " ".join(
        [
            str(command_result.get("error") or ""),
            str(command_result.get("errorMessage") or ""),
            str(command_result.get("responseBodySnippet") or ""),
        ]
    ).lower()
    return "page.once is not a function" in error_text or "client.page.once" in error_text


def build_navigate_fallback_expression(url: str) -> str:
    escaped = json.dumps(url)
    return (
        "(() => { "
        f"window.location.assign({escaped}); "
        "return { ok: true, via: 'location.assign' }; "
        "})()"
    )


def classify_failure_bucket(runtime_entry: Dict[str, Any]) -> str:
    tooling_error_codes = {
        "CDP_UNAVAILABLE",
        "SESSION_NOT_FOUND",
        "TARGET_NOT_FOUND",
        "SESSION_ALREADY_RUNNING",
        "COMMAND_TIMEOUT",
        "VALIDATION_ERROR",
        "AMBIGUOUS_TARGET",
        "IMAGE_DIMENSION_MISMATCH",
        "FILE_NOT_FOUND",
        "UNSUPPORTED_IMAGE_FORMAT",
    }

    command_entries = runtime_entry.get("commands")
    if isinstance(command_entries, list):
        for item in command_entries:
            if not isinstance(item, dict):
                continue
            error_code = item.get("errorCode")
            if isinstance(error_code, str) and error_code in tooling_error_codes:
                return "tooling"

    for key in ["snapshot", "compareReference"]:
        record = runtime_entry.get(key)
        if isinstance(record, dict):
            error_code = record.get("errorCode")
            if isinstance(error_code, str) and error_code in tooling_error_codes:
                return "tooling"

    return "app"


def is_stale_transport_error(
    error_message: Optional[str],
    response_body_snippet: Optional[str],
) -> bool:
    text = " ".join(
        [
            str(error_message or ""),
            str(response_body_snippet or ""),
        ]
    ).lower()
    return any(hint in text for hint in STALE_TRANSPORT_HINTS)


def build_failure_next_action(
    *,
    source: str,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
    response_body_snippet: Optional[str] = None,
    failure_category: Optional[str] = None,
) -> Dict[str, Any]:
    normalized_code = error_code.strip().upper() if isinstance(error_code, str) and error_code.strip() else None
    normalized_category = (
        failure_category.strip().lower()
        if isinstance(failure_category, str) and failure_category.strip()
        else None
    )
    stale_transport = is_stale_transport_error(error_message, response_body_snippet)

    if normalized_category == "target-not-found" or normalized_code == "TARGET_NOT_FOUND":
        return {
            "id": "open-tab-recovery",
            "label": "Open missing tab and retry",
            "reason": "Target tab was not found while ensuring session.",
            "command": PIPELINE_RETRY_FORCE_RECOVERY_COMMAND,
            "source": source,
        }

    if normalized_category == "session-already-running" or normalized_code == "SESSION_ALREADY_RUNNING":
        return {
            "id": "replace-active-session",
            "label": "Replace active session",
            "reason": "Active session conflict blocked ensure/reuse flow.",
            "command": SESSION_RESTART_COMMAND,
            "source": source,
        }

    if normalized_category == "cdp-unavailable" or normalized_code == "CDP_UNAVAILABLE":
        return {
            "id": "recover-cdp-session",
            "label": "Recover CDP and session",
            "reason": "CDP endpoint/session channel is unavailable.",
            "command": VISUAL_START_RECOVERY_COMMAND,
            "source": source,
        }

    if normalized_category == "ambiguous-target" or normalized_code == "AMBIGUOUS_TARGET":
        return {
            "id": "use-exact-target",
            "label": "Use exact target match",
            "reason": "Multiple tabs matched the requested target URL.",
            "command": PIPELINE_RETRY_EXACT_COMMAND,
            "source": source,
        }

    if normalized_code == "IMAGE_DIMENSION_MISMATCH":
        return {
            "id": "normalize-reference-size",
            "label": "Retry with resize fallback",
            "reason": "Reference/actual image dimensions differ.",
            "command": PIPELINE_RETRY_BASE_COMMAND,
            "source": source,
        }

    if normalized_code == "COMMAND_TIMEOUT":
        return {
            "id": "increase-timeout",
            "label": "Retry with longer timeout",
            "reason": "Command exceeded timeout window before completion.",
            "command": PIPELINE_RETRY_TIMEOUT_COMMAND,
            "source": source,
        }

    if normalized_code == "FILE_NOT_FOUND":
        return {
            "id": "verify-reference-path",
            "label": "Verify file path",
            "reason": "A referenced file path could not be resolved.",
            "command": "ls -l <reference-image-path>",
            "source": source,
        }

    if normalized_code == "VALIDATION_ERROR":
        if stale_transport:
            return {
                "id": "stale-transport-retry",
                "label": "Retry with fresh session",
                "reason": "Validation error indicates stale/closed transport state.",
                "command": PIPELINE_RETRY_FORCE_RECOVERY_COMMAND,
                "source": source,
            }
        return {
            "id": "fix-scenario-payload",
            "label": "Fix scenario payload and retry",
            "reason": "Validation failed for scenario command payload.",
            "command": PIPELINE_RETRY_BASE_COMMAND,
            "source": source,
        }

    return {
        "id": "rerun-terminal-probe",
        "label": "Rerun terminal-probe",
        "reason": "Collect deterministic runtime artifacts for the next failure pass.",
        "command": PIPELINE_RETRY_BASE_COMMAND,
        "source": source,
    }


def select_primary_next_action(runtime_scenarios: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    for runtime_entry in runtime_scenarios:
        if bool(runtime_entry.get("ok")):
            continue
        next_action = runtime_entry.get("nextAction")
        if isinstance(next_action, dict):
            return next_action
    return None


def build_black_screen_verdict(
    metrics_scenarios: List[Dict[str, Any]],
    runtime_scenarios: List[Dict[str, Any]],
    black_frame_candidates: List[str],
    framebuffer_metric_mismatches: List[str],
) -> Dict[str, Any]:
    screenshot_black_scenarios: List[str] = []
    screenshot_non_black_scenarios: List[str] = []
    framebuffer_black_scenarios: List[str] = []
    runtime_render_error_scenarios: List[str] = []

    for metrics_entry in metrics_scenarios:
        if not isinstance(metrics_entry, dict):
            continue
        scenario_name = metrics_entry.get("name")
        if not isinstance(scenario_name, str):
            continue

        image_metrics = metrics_entry.get("imageMetrics")
        if isinstance(image_metrics, dict):
            non_black_ratio = image_metrics.get("nonBlackRatio")
            if isinstance(non_black_ratio, (int, float)):
                if float(non_black_ratio) < 0.01:
                    screenshot_black_scenarios.append(scenario_name)
                else:
                    screenshot_non_black_scenarios.append(scenario_name)

        framebuffer_ratio = metrics_entry.get("framebufferNonBlackRatio")
        if isinstance(framebuffer_ratio, (int, float)) and float(framebuffer_ratio) < 0.01:
            framebuffer_black_scenarios.append(scenario_name)

    render_error_hints = ["webgl", "shader", "render", "canvas", "context lost"]
    for runtime_entry in runtime_scenarios:
        if not isinstance(runtime_entry, dict):
            continue
        scenario_name = runtime_entry.get("name")
        if not isinstance(scenario_name, str):
            continue
        errors = runtime_entry.get("errors")
        if not isinstance(errors, list):
            continue
        combined_error_text = " ".join(str(item) for item in errors).lower()
        if any(hint in combined_error_text for hint in render_error_hints):
            runtime_render_error_scenarios.append(scenario_name)

    if screenshot_black_scenarios:
        confidence = "high" if runtime_render_error_scenarios else "medium"
        rationale = (
            "Screenshot metrics show black frames; runtime render errors are also present."
            if runtime_render_error_scenarios
            else "Screenshot metrics show black frames."
        )
        status = "black-screen-probable"
    elif runtime_render_error_scenarios:
        confidence = "medium"
        rationale = "Runtime render errors detected without black screenshot metrics."
        status = "render-errors-without-black-screenshot"
    elif framebuffer_metric_mismatches:
        confidence = "medium"
        rationale = (
            "Framebuffer reported black, but screenshot metrics are non-black; "
            "screenshot metrics + runtime errors are treated as source of truth."
        )
        status = "non-black-screenshot-with-framebuffer-black"
    elif screenshot_non_black_scenarios:
        confidence = "high"
        rationale = "Screenshot metrics indicate non-black frames and no render-error evidence."
        status = "no-black-screen-evidence"
    else:
        confidence = "low"
        rationale = "Insufficient screenshot metrics to determine black-screen status."
        status = "insufficient-evidence"

    return {
        "status": status,
        "confidence": confidence,
        "sourceOfTruth": "screenshot-metrics-plus-runtime-errors",
        "rationale": rationale,
        "evidence": {
            "screenshotBlackScenarios": sorted(set(screenshot_black_scenarios)),
            "screenshotNonBlackScenarios": sorted(set(screenshot_non_black_scenarios)),
            "framebufferBlackScenarios": sorted(set(framebuffer_black_scenarios)),
            "framebufferMetricMismatches": sorted(set(framebuffer_metric_mismatches)),
            "blackFrameCandidates": sorted(set(black_frame_candidates)),
            "runtimeRenderErrorScenarios": sorted(set(runtime_render_error_scenarios)),
        },
    }


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
    session_lifecycle: Optional[Dict[str, Any]] = None,
    normalize_reference_size: bool = True,
    resize_interpolation: str = DEFAULT_RESIZE_INTERPOLATION,
    navigate_fallback: bool = True,
    mode_selection: Optional[Dict[str, Any]] = None,
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
            "nextAction": None,
        }

        scenario_failed = False

        for raw_step in scenario_commands:
            if not isinstance(raw_step, dict):
                runtime_entry["errors"].append("Scenario command step must be an object")
                runtime_entry["nextAction"] = build_failure_next_action(
                    source="scenario-definition",
                    error_message="Scenario command step must be an object",
                )
                scenario_failed = True
                break

            try:
                command, payload = command_payload_from_step(raw_step, timeout_ms)
            except RuntimeError as exc:
                runtime_entry["errors"].append(str(exc))
                runtime_entry["nextAction"] = build_failure_next_action(
                    source="scenario-definition",
                    error_code="VALIDATION_ERROR",
                    error_message=str(exc),
                )
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
                    "errorCode": command_result.get("errorCode"),
                    "errorMessage": command_result.get("errorMessage"),
                    "errorDetails": command_result.get("errorDetails"),
                    "responseBodySnippet": command_result.get("responseBodySnippet"),
                    "result": command_result.get("result"),
                }
            )
            if not command_result["ok"]:
                fallback_recovered = False
                if command == "navigate" and navigate_fallback and should_retry_navigate_with_evaluate(command_result):
                    fallback_payload = {
                        "expression": build_navigate_fallback_expression(str(payload.get("url") or "")),
                        "awaitPromise": True,
                        "returnByValue": True,
                        "timeoutMs": timeout_ms,
                    }
                    fallback_result = run_core_command(
                        core_base_url,
                        session_id,
                        "evaluate",
                        fallback_payload,
                        timeout_seconds,
                    )
                    runtime_entry["commands"].append(
                        {
                            "command": "evaluate",
                            "payload": fallback_payload,
                            "ok": fallback_result["ok"],
                            "status": fallback_result.get("status"),
                            "error": fallback_result.get("error"),
                            "errorCode": fallback_result.get("errorCode"),
                            "errorMessage": fallback_result.get("errorMessage"),
                            "errorDetails": fallback_result.get("errorDetails"),
                            "responseBodySnippet": fallback_result.get("responseBodySnippet"),
                            "result": fallback_result.get("result"),
                            "fallbackFor": "navigate",
                        }
                    )
                    if fallback_result["ok"]:
                        fallback_recovered = True
                        warnings.append(
                            "Navigate fallback used evaluate(window.location.assign(...)) after navigate command failure."
                        )
                    else:
                        runtime_entry["nextAction"] = build_failure_next_action(
                            source="scenario-command",
                            error_code=(
                                str(fallback_result.get("errorCode"))
                                if isinstance(fallback_result.get("errorCode"), str)
                                else None
                            ),
                            error_message=(
                                str(fallback_result.get("errorMessage"))
                                if isinstance(fallback_result.get("errorMessage"), str)
                                else str(fallback_result.get("error"))
                            ),
                            response_body_snippet=(
                                str(fallback_result.get("responseBodySnippet"))
                                if isinstance(fallback_result.get("responseBodySnippet"), str)
                                else None
                            ),
                        )
                        scenario_failed = True
                        fallback_error_code = fallback_result.get("errorCode")
                        if isinstance(fallback_error_code, str) and fallback_error_code:
                            runtime_entry["errors"].append(
                                "Scenario command 'navigate' fallback failed "
                                f"[{fallback_error_code}]: {fallback_result.get('error')}"
                            )
                        else:
                            runtime_entry["errors"].append(
                                "Scenario command 'navigate' fallback failed: "
                                f"{fallback_result.get('error')}"
                            )
                        break

                if fallback_recovered:
                    continue

                scenario_failed = True
                runtime_entry["nextAction"] = build_failure_next_action(
                    source="scenario-command",
                    error_code=(
                        str(command_result.get("errorCode"))
                        if isinstance(command_result.get("errorCode"), str)
                        else None
                    ),
                    error_message=(
                        str(command_result.get("errorMessage"))
                        if isinstance(command_result.get("errorMessage"), str)
                        else str(command_result.get("error"))
                    ),
                    response_body_snippet=(
                        str(command_result.get("responseBodySnippet"))
                        if isinstance(command_result.get("responseBodySnippet"), str)
                        else None
                    ),
                )
                command_error_code = command_result.get("errorCode")
                if isinstance(command_error_code, str) and command_error_code:
                    runtime_entry["errors"].append(
                        f"Scenario command '{command}' failed [{command_error_code}]: {command_result.get('error')}"
                    )
                else:
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
                "errorCode": snapshot_result.get("errorCode"),
                "errorMessage": snapshot_result.get("errorMessage"),
                "errorDetails": snapshot_result.get("errorDetails"),
                "responseBodySnippet": snapshot_result.get("responseBodySnippet"),
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
                    runtime_entry["nextAction"] = build_failure_next_action(
                        source="snapshot",
                        error_message="Snapshot command returned no image path",
                    )
            else:
                scenario_failed = True
                runtime_entry["nextAction"] = build_failure_next_action(
                    source="snapshot",
                    error_code=(
                        str(snapshot_result.get("errorCode"))
                        if isinstance(snapshot_result.get("errorCode"), str)
                        else None
                    ),
                    error_message=(
                        str(snapshot_result.get("errorMessage"))
                        if isinstance(snapshot_result.get("errorMessage"), str)
                        else str(snapshot_result.get("error"))
                    ),
                    response_body_snippet=(
                        str(snapshot_result.get("responseBodySnippet"))
                        if isinstance(snapshot_result.get("responseBodySnippet"), str)
                        else None
                    ),
                )
                snapshot_error_code = snapshot_result.get("errorCode")
                if isinstance(snapshot_error_code, str) and snapshot_error_code:
                    runtime_entry["errors"].append(
                        f"Snapshot failed [{snapshot_error_code}]: {snapshot_result.get('error')}"
                    )
                else:
                    runtime_entry["errors"].append(f"Snapshot failed: {snapshot_result.get('error')}")

        compare_result: Optional[Dict[str, Any]] = None
        if not scenario_failed and isinstance(reference_image_path, str) and reference_image_path.strip() and snapshot_path:
            compare_payload_strict = {
                "actualImagePath": snapshot_path,
                "referenceImagePath": reference_image_path,
                "label": scenario_name,
                "writeDiff": True,
                "dimensionPolicy": "strict",
                "resizeInterpolation": resize_interpolation,
            }
            compare_attempts: List[Dict[str, Any]] = []
            compare_result = run_core_command(
                core_base_url,
                session_id,
                "compare-reference",
                compare_payload_strict,
                timeout_seconds,
            )
            compare_attempts.append(
                {
                    "ok": compare_result["ok"],
                    "status": compare_result.get("status"),
                    "error": compare_result.get("error"),
                    "errorCode": compare_result.get("errorCode"),
                    "errorMessage": compare_result.get("errorMessage"),
                    "errorDetails": compare_result.get("errorDetails"),
                    "responseBodySnippet": compare_result.get("responseBodySnippet"),
                    "payload": compare_payload_strict,
                    "result": compare_result.get("result"),
                }
            )

            if (
                not compare_result["ok"]
                and compare_result.get("errorCode") == "IMAGE_DIMENSION_MISMATCH"
                and normalize_reference_size
            ):
                compare_payload_resize = {
                    "actualImagePath": snapshot_path,
                    "referenceImagePath": reference_image_path,
                    "label": scenario_name,
                    "writeDiff": True,
                    "dimensionPolicy": "resize-reference-to-actual",
                    "resizeInterpolation": resize_interpolation,
                }
                compare_result = run_core_command(
                    core_base_url,
                    session_id,
                    "compare-reference",
                    compare_payload_resize,
                    timeout_seconds,
                )
                compare_attempts.append(
                    {
                        "ok": compare_result["ok"],
                        "status": compare_result.get("status"),
                        "error": compare_result.get("error"),
                        "errorCode": compare_result.get("errorCode"),
                        "errorMessage": compare_result.get("errorMessage"),
                        "errorDetails": compare_result.get("errorDetails"),
                        "responseBodySnippet": compare_result.get("responseBodySnippet"),
                        "payload": compare_payload_resize,
                        "result": compare_result.get("result"),
                    }
                )
                if compare_result["ok"]:
                    warnings.append(
                        f"compare-reference auto-resized reference for scenario '{scenario_name}' "
                        f"using {resize_interpolation} interpolation."
                    )

            final_compare_payload = (
                compare_attempts[-1].get("payload") if compare_attempts else compare_payload_strict
            )
            runtime_entry["compareReference"] = {
                "ok": compare_result["ok"],
                "status": compare_result.get("status"),
                "error": compare_result.get("error"),
                "errorCode": compare_result.get("errorCode"),
                "errorMessage": compare_result.get("errorMessage"),
                "errorDetails": compare_result.get("errorDetails"),
                "responseBodySnippet": compare_result.get("responseBodySnippet"),
                "payload": final_compare_payload,
                "result": compare_result.get("result"),
                "attempts": compare_attempts,
                "fallbackApplied": len(compare_attempts) > 1,
            }
            if not compare_result["ok"]:
                scenario_failed = True
                runtime_entry["nextAction"] = build_failure_next_action(
                    source="compare-reference",
                    error_code=(
                        str(compare_result.get("errorCode"))
                        if isinstance(compare_result.get("errorCode"), str)
                        else None
                    ),
                    error_message=(
                        str(compare_result.get("errorMessage"))
                        if isinstance(compare_result.get("errorMessage"), str)
                        else str(compare_result.get("error"))
                    ),
                    response_body_snippet=(
                        str(compare_result.get("responseBodySnippet"))
                        if isinstance(compare_result.get("responseBodySnippet"), str)
                        else None
                    ),
                )
                compare_error_code = compare_result.get("errorCode")
                if isinstance(compare_error_code, str) and compare_error_code:
                    runtime_entry["errors"].append(
                        f"compare-reference failed [{compare_error_code}]: {compare_result.get('error')}"
                    )
                else:
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
        if scenario_failed and not isinstance(runtime_entry.get("nextAction"), dict):
            runtime_entry["nextAction"] = build_failure_next_action(
                source="scenario",
                error_message="Scenario failed without categorized error details",
            )

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
    tooling_failures = [
        entry.get("name")
        for entry in runtime_scenarios
        if not bool(entry.get("ok")) and classify_failure_bucket(entry) == "tooling"
    ]
    app_failures = [
        entry.get("name")
        for entry in runtime_scenarios
        if not bool(entry.get("ok")) and classify_failure_bucket(entry) == "app"
    ]
    primary_next_action = None if overall_ok else select_primary_next_action(runtime_scenarios)
    black_screen_verdict = build_black_screen_verdict(
        metrics_scenarios=metrics_scenarios,
        runtime_scenarios=runtime_scenarios,
        black_frame_candidates=black_frame_candidates,
        framebuffer_metric_mismatches=framebuffer_metric_mismatches,
    )

    runtime_payload = {
        "generatedAt": iso_now(),
        "mode": "terminal-probe",
        "modeSelection": mode_selection,
        "sessionId": session_id,
        "coreBaseUrl": core_base_url,
        "sessionLifecycle": session_lifecycle,
        "scenarioCount": len(runtime_scenarios),
        "scenarios": runtime_scenarios,
        "blackScreenVerdict": black_screen_verdict,
        "nextAction": primary_next_action,
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
        "modeSelection": mode_selection,
        "sessionId": session_id,
        "sessionLifecycle": session_lifecycle,
        "ok": overall_ok,
        "scenarioCount": len(runtime_scenarios),
        "failedScenarioCount": len([entry for entry in runtime_scenarios if not bool(entry.get("ok"))]),
        "scenariosWithReference": len([entry for entry in metrics_scenarios if entry.get("compareMetrics") is not None]),
        "toolingFailures": [item for item in tooling_failures if isinstance(item, str)],
        "appFailures": [item for item in app_failures if isinstance(item, str)],
        "averages": {
            "mean": average(mean_values),
            "stddev": average(stddev_values),
            "nonBlackRatio": average(non_black_values),
            "maeRgb": average(mae_rgb_values),
        },
        "blackFrameCandidates": black_frame_candidates,
        "framebufferMetricMismatches": framebuffer_metric_mismatches,
        "blackScreenVerdict": black_screen_verdict,
        "nextAction": primary_next_action,
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
        "toolingFailures": summary_payload["toolingFailures"],
        "appFailures": summary_payload["appFailures"],
        "blackScreenVerdict": black_screen_verdict,
        "nextAction": primary_next_action,
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
        "--tab-url-match-strategy",
        choices=["exact", "origin-path", "origin"],
        default=DEFAULT_TAB_URL_MATCH_STRATEGY,
        help="Target matching strategy used for /session/ensure in auto mode",
    )
    parser.add_argument(
        "--no-reuse-active",
        action="store_true",
        help="When using --session-id auto, do not reuse active session",
    )
    parser.add_argument(
        "--force-new-session",
        action="store_true",
        help="When using --session-id auto, stop active session first and always ensure a fresh session",
    )
    parser.add_argument(
        "--open-tab-if-missing",
        dest="open_tab_if_missing",
        action="store_true",
        default=True,
        help=(
            "When auto session ensure reports TARGET_NOT_FOUND, open tab via CDP /json/new "
            "and retry once (default: enabled)"
        ),
    )
    parser.add_argument(
        "--no-open-tab-if-missing",
        dest="open_tab_if_missing",
        action="store_false",
        help="Disable automatic open-tab recovery when --session-id auto",
    )
    parser.add_argument("--scenarios", required=True, help="Path to scenario JSON file")
    parser.add_argument("--output-dir", default=None, help="Optional output directory for artifact bundle")
    parser.add_argument("--timeout-ms", type=int, default=15000, help="Default command timeout in milliseconds")
    parser.add_argument(
        "--no-normalize-reference-size",
        action="store_true",
        help="Disable automatic compare-reference retry with resize-reference-to-actual",
    )
    parser.add_argument(
        "--resize-interpolation",
        choices=["nearest", "bilinear"],
        default=DEFAULT_RESIZE_INTERPOLATION,
        help="Interpolation mode used when auto-resizing reference images",
    )
    parser.add_argument(
        "--no-navigate-fallback",
        action="store_true",
        help="Disable navigate->evaluate(location.assign) fallback for known navigate transport failures",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable output")

    args = parser.parse_args()

    project_root = Path(args.project_root).expanduser().resolve()
    scenarios_path = Path(args.scenarios).expanduser().resolve()
    if not scenarios_path.exists():
        print(f"terminal_probe_pipeline.py failed: scenario file does not exist: {scenarios_path}", file=sys.stderr)
        return 1

    try:
        requested_session_id = str(args.session_id).strip()
        session_lifecycle: Optional[Dict[str, Any]] = None
        mode_selection = {
            "selectedMode": "Enhanced mode (fix-app-bugs optional addon)",
            "executionMode": "terminal-probe",
            "reason": (
                "Terminal-probe pipeline explicitly selected for machine-verifiable fallback "
                "or direct scenario capture."
            ),
            "alternateMode": "browser-fetch",
            "alternateModeRationale": (
                "Not selected because this command path is the terminal-probe fallback/capture lane."
            ),
        }
        resolved_session: Dict[str, Any] = {
            "requestedSessionId": requested_session_id,
            "resolvedSessionId": requested_session_id,
            "auto": False,
            "reused": None,
            "tabUrl": None,
            "tabUrlMatchStrategy": args.tab_url_match_strategy,
            "forceNewSession": bool(args.force_new_session),
            "openTabIfMissing": bool(args.open_tab_if_missing),
        }
        if requested_session_id.lower() == "auto":
            tab_url = str(args.tab_url).strip() if isinstance(args.tab_url, str) else ""
            if not tab_url:
                print(
                    "terminal_probe_pipeline.py failed: --tab-url is required when --session-id auto",
                    file=sys.stderr,
                )
                return 1
            auto_session_result = resolve_auto_session(
                core_base_url=str(args.core_base_url),
                tab_url=tab_url,
                debug_port=max(int(args.debug_port), 1),
                reuse_active=not bool(args.no_reuse_active),
                force_new_session=bool(args.force_new_session),
                open_tab_if_missing=bool(args.open_tab_if_missing),
                tab_url_match_strategy=str(args.tab_url_match_strategy),
                timeout_seconds=max(float(args.timeout_ms) / 1000.0, 3.0),
            )
            ensured = auto_session_result["ensured"]
            session_lifecycle = auto_session_result.get("lifecycle")
            resolved_tab_url = auto_session_result.get("resolvedTabUrl")
            resolved_match_strategy = auto_session_result.get("tabUrlMatchStrategy")
            resolved_session = {
                "requestedSessionId": requested_session_id,
                "resolvedSessionId": ensured["sessionId"],
                "auto": True,
                "reused": ensured.get("reused"),
                "tabUrl": (
                    resolved_tab_url
                    if isinstance(resolved_tab_url, str) and resolved_tab_url
                    else ensured.get("attachedTargetUrl") or tab_url
                ),
                "tabUrlMatchStrategy": (
                    str(resolved_match_strategy)
                    if isinstance(resolved_match_strategy, str) and resolved_match_strategy
                    else str(args.tab_url_match_strategy)
                ),
                "forceNewSession": bool(args.force_new_session),
                "openTabIfMissing": bool(args.open_tab_if_missing),
                "lifecycle": session_lifecycle,
            }
        else:
            session_lifecycle = {
                "forceNewSession": False,
                "openTabIfMissing": False,
                "failureCategory": None,
                "ensureAttempts": 0,
                "firstEnsureAttemptSucceeded": False,
                "fallbackUsed": False,
                "fallbackActionsUsed": [],
                "attachBranch": "explicit-session-id",
                "actions": [],
            }

        scenarios = load_scenarios(scenarios_path)
        output_dir = prepare_output_dir(project_root, args.output_dir, str(resolved_session["resolvedSessionId"]))
        result = run_pipeline(
            core_base_url=str(args.core_base_url),
            session_id=str(resolved_session["resolvedSessionId"]),
            scenarios=scenarios,
            output_dir=output_dir,
            timeout_ms=max(int(args.timeout_ms), 1000),
            session_lifecycle=session_lifecycle,
            normalize_reference_size=not bool(args.no_normalize_reference_size),
            resize_interpolation=str(args.resize_interpolation),
            navigate_fallback=not bool(args.no_navigate_fallback),
            mode_selection=mode_selection,
        )
        result["modeSelection"] = mode_selection
        result["resolvedSession"] = resolved_session
    except AutoSessionResolutionError as exc:
        next_action = build_failure_next_action(
            source="session-lifecycle",
            error_code=exc.error_code,
            error_message=str(exc),
            failure_category=exc.failure_category,
        )
        error_payload = {
            "ok": False,
            "error": str(exc),
            "errorCode": exc.error_code,
            "failureCategory": exc.failure_category,
            "sessionLifecycle": exc.lifecycle,
            "nextAction": next_action,
        }
        if args.json:
            print(json.dumps(error_payload, ensure_ascii=True))
        else:
            print(f"terminal_probe_pipeline.py failed: {exc}", file=sys.stderr)
            print(f"- nextAction: {json.dumps(next_action, ensure_ascii=True)}")
        return 1
    except Exception as exc:  # noqa: BLE001
        next_action = build_failure_next_action(
            source="pipeline",
            error_message=str(exc),
        )
        if args.json:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "error": str(exc),
                        "nextAction": next_action,
                    },
                    ensure_ascii=True,
                )
            )
            return 1
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
        session_lifecycle = result.get("resolvedSession", {}).get("lifecycle")
        if isinstance(session_lifecycle, dict):
            print(f"- sessionLifecycle: {json.dumps(session_lifecycle, ensure_ascii=True)}")
        if isinstance(result.get("blackScreenVerdict"), dict):
            print(f"- blackScreenVerdict: {json.dumps(result['blackScreenVerdict'], ensure_ascii=True)}")
        if isinstance(result.get("nextAction"), dict):
            print(f"- nextAction: {json.dumps(result['nextAction'], ensure_ascii=True)}")
        if result["warnings"]:
            print(f"- warnings: {json.dumps(result['warnings'], ensure_ascii=True)}")

    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())

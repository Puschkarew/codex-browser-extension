#!/usr/bin/env python3
import argparse
import copy
import difflib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

DEFAULT_PLUGIN_ROOT = Path(
    "/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension"
)
LOOPBACK_DOMAINS = ("localhost", "127.0.0.1")


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9-]+", "-", value.strip().lower())
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "project"


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_json_or_none(raw: str) -> Optional[Any]:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def canonicalize_url(raw_url: str) -> str:
    value = raw_url.strip()
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise RuntimeError(f"Invalid URL: {raw_url}")

    path = parsed.path
    if path == "/":
        path = ""
    query = f"?{parsed.query}" if parsed.query else ""
    fragment = f"#{parsed.fragment}" if parsed.fragment else ""
    return f"{parsed.scheme}://{parsed.netloc}{path}{query}{fragment}"


def get_origin(raw_url: str) -> str:
    parsed = urlparse(canonicalize_url(raw_url))
    return f"{parsed.scheme}://{parsed.netloc}"


def default_port(scheme: str) -> int:
    if scheme == "https":
        return 443
    return 80


def parse_origin_parts(raw_url: str) -> Dict[str, Any]:
    parsed = urlparse(canonicalize_url(raw_url))
    scheme = parsed.scheme.lower()
    hostname = (parsed.hostname or "").lower()
    port = parsed.port if parsed.port is not None else default_port(scheme)
    return {
        "scheme": scheme,
        "hostname": hostname,
        "port": port,
    }


def canonical_origin_for_match(raw_url: str) -> str:
    parts = parse_origin_parts(raw_url)
    hostname = parts["hostname"]
    if hostname in LOOPBACK_DOMAINS:
        hostname = "loopback"
    return f"{parts['scheme']}://{hostname}:{parts['port']}"


def evaluate_origin_match(config_app_url: str, actual_app_url: str) -> Dict[str, Any]:
    config_origin = get_origin(config_app_url)
    actual_origin = get_origin(actual_app_url)
    config_parts = parse_origin_parts(config_app_url)
    actual_parts = parse_origin_parts(actual_app_url)

    exact_match = (
        config_parts["scheme"] == actual_parts["scheme"]
        and config_parts["hostname"] == actual_parts["hostname"]
        and config_parts["port"] == actual_parts["port"]
    )
    loopback_equivalent = (
        config_parts["scheme"] == actual_parts["scheme"]
        and config_parts["port"] == actual_parts["port"]
        and config_parts["hostname"] in LOOPBACK_DOMAINS
        and actual_parts["hostname"] in LOOPBACK_DOMAINS
    )

    if exact_match:
        return {
            "ok": True,
            "status": "match",
            "reason": None,
            "matchType": "exact",
            "needsConfigSync": False,
            "configOrigin": config_origin,
            "actualOrigin": actual_origin,
            "canonicalConfigOrigin": canonical_origin_for_match(config_app_url),
            "canonicalActualOrigin": canonical_origin_for_match(actual_app_url),
        }

    if loopback_equivalent:
        return {
            "ok": True,
            "status": "match",
            "reason": (
                "config/actual origins are loopback-equivalent "
                f"({config_origin} ~= {actual_origin})"
            ),
            "matchType": "loopback-equivalent",
            "needsConfigSync": True,
            "configOrigin": config_origin,
            "actualOrigin": actual_origin,
            "canonicalConfigOrigin": canonical_origin_for_match(config_app_url),
            "canonicalActualOrigin": canonical_origin_for_match(actual_app_url),
        }

    return {
        "ok": False,
        "status": "mismatch",
        "reason": f"config origin {config_origin} differs from actual origin {actual_origin}",
        "matchType": "mismatch",
        "needsConfigSync": True,
        "configOrigin": config_origin,
        "actualOrigin": actual_origin,
        "canonicalConfigOrigin": canonical_origin_for_match(config_app_url),
        "canonicalActualOrigin": canonical_origin_for_match(actual_app_url),
    }


def is_loopback_url(raw_url: str) -> bool:
    parsed = urlparse(canonicalize_url(raw_url))
    hostname = (parsed.hostname or "").lower()
    return hostname in LOOPBACK_DOMAINS


def normalize_domains(raw_domains: List[Any]) -> List[str]:
    normalized: List[str] = []
    seen = set()
    for item in raw_domains:
        value = str(item).strip().lower()
        if not value or value in seen:
            continue
        normalized.append(value)
        seen.add(value)
    return normalized


def http_request(
    method: str,
    url: str,
    payload: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    timeout: float = 1.5,
) -> Dict[str, Any]:
    request_headers: Dict[str, str] = {"Content-Type": "application/json"}
    if headers:
        request_headers.update(headers)

    body = None
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")

    request = Request(url=url, data=body, headers=request_headers, method=method)

    try:
        with urlopen(request, timeout=timeout) as response:
            raw_body = response.read().decode("utf-8")
            return {
                "ok": 200 <= response.status < 300,
                "status": response.status,
                "headers": {str(k).lower(): str(v) for k, v in response.headers.items()},
                "body": raw_body,
                "json": parse_json_or_none(raw_body),
            }
    except HTTPError as exc:
        raw_body = exc.read().decode("utf-8", errors="replace")
        return {
            "ok": False,
            "status": exc.code,
            "headers": {str(k).lower(): str(v) for k, v in (exc.headers.items() if exc.headers else [])},
            "body": raw_body,
            "json": parse_json_or_none(raw_body),
            "error": str(exc),
        }
    except (URLError, TimeoutError, ValueError) as exc:
        return {
            "ok": False,
            "status": None,
            "headers": {},
            "body": "",
            "json": None,
            "error": str(exc),
        }


def check_health(core_base_url: str, timeout: float = 1.0) -> Optional[Dict[str, Any]]:
    response = http_request("GET", f"{core_base_url}/health", timeout=timeout)
    if not response.get("ok"):
        return None
    payload = response.get("json")
    if not isinstance(payload, dict):
        return None
    if payload.get("status") != "ok":
        return None
    return payload


def wait_for_health(core_base_url: str, deadline_seconds: float = 15.0) -> Optional[Dict[str, Any]]:
    started = time.time()
    while time.time() - started <= deadline_seconds:
        payload = check_health(core_base_url)
        if payload:
            return payload
        time.sleep(0.5)
    return None


def resolve_plugin_root(plugin_root_arg: Optional[str]) -> Path:
    if plugin_root_arg:
        root = Path(plugin_root_arg).expanduser().resolve()
    elif os.environ.get("BROWSER_DEBUG_PLUGIN_ROOT"):
        root = Path(os.environ["BROWSER_DEBUG_PLUGIN_ROOT"]).expanduser().resolve()
    else:
        root = DEFAULT_PLUGIN_ROOT

    package_json = root / "package.json"
    if not package_json.exists():
        raise RuntimeError(f"Plugin root is invalid: {root} (package.json not found)")

    try:
        package = json.loads(package_json.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Plugin package.json is invalid JSON: {exc}") from exc

    if package.get("name") != "browser-debug-plugin":
        raise RuntimeError(f"Plugin root {root} does not contain browser-debug-plugin")

    return root


def default_project_config(project_root: Path) -> Dict[str, Any]:
    app_url = "http://localhost:3000"
    app_host = urlparse(app_url).hostname or "localhost"

    return {
        "version": 1,
        "projectId": slugify(project_root.name),
        "appUrl": app_url,
        "agent": {
            "host": "127.0.0.1",
            "corePort": 4678,
            "debugPort": 7331,
        },
        "browser": {
            "cdpPort": 9222,
        },
        "capture": {
            "allowedDomains": [app_host],
            "networkAllowlist": [],
        },
        "defaults": {
            "queryWindowMinutes": 30,
        },
    }


def ensure_project_config(project_root: Path) -> Tuple[Path, Dict[str, Any], bool]:
    config_dir = project_root / ".codex"
    config_path = config_dir / "browser-debug.json"

    if not config_path.exists():
        config_dir.mkdir(parents=True, exist_ok=True)
        config = default_project_config(project_root)
        config_path.write_text(json.dumps(config, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
        return config_path, config, True

    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Project config is invalid JSON: {config_path}: {exc}") from exc

    return config_path, config, False


def validate_config(config: Dict[str, Any]) -> Dict[str, Any]:
    required_top = ["version", "projectId", "appUrl", "agent", "browser", "capture", "defaults"]
    for key in required_top:
        if key not in config:
            raise RuntimeError(f"Project config is missing '{key}'")

    if config["version"] != 1:
        raise RuntimeError("Project config 'version' must be 1")

    app_url = canonicalize_url(str(config["appUrl"]))
    config["appUrl"] = app_url
    parsed = urlparse(app_url)

    agent = config["agent"]
    for key in ["host", "corePort", "debugPort"]:
        if key not in agent:
            raise RuntimeError(f"Project config 'agent.{key}' is required")

    browser = config["browser"]
    if "cdpPort" not in browser:
        raise RuntimeError("Project config 'browser.cdpPort' is required")

    capture = config["capture"]
    if "allowedDomains" not in capture or not isinstance(capture["allowedDomains"], list):
        raise RuntimeError("Project config 'capture.allowedDomains' must be an array")

    allowed_domains = normalize_domains(capture["allowedDomains"])
    parsed_hostname = (parsed.hostname or "").lower()
    if parsed_hostname and parsed_hostname not in allowed_domains:
        allowed_domains.append(parsed_hostname)
    capture["allowedDomains"] = allowed_domains

    if "networkAllowlist" not in capture or not isinstance(capture["networkAllowlist"], list):
        capture["networkAllowlist"] = []

    defaults = config["defaults"]
    if "queryWindowMinutes" not in defaults:
        defaults["queryWindowMinutes"] = 30

    return config


def evaluate_app_url_check(config_app_url: str, actual_app_url: Optional[str]) -> Dict[str, Any]:
    config_origin = get_origin(config_app_url)
    check: Dict[str, Any] = {
        "ok": False,
        "status": "not-provided",
        "configAppUrl": config_app_url,
        "actualAppUrl": None,
        "configOrigin": config_origin,
        "actualOrigin": None,
        "canonicalConfigOrigin": canonical_origin_for_match(config_app_url),
        "canonicalActualOrigin": None,
        "matchType": "not-evaluated",
        "needsConfigSync": False,
        "reason": "actual app URL is required; rerun bootstrap with --actual-app-url <url>",
    }

    if not actual_app_url:
        return check

    try:
        normalized_actual = canonicalize_url(actual_app_url)
    except RuntimeError as exc:
        check["ok"] = False
        check["status"] = "invalid-actual-url"
        check["reason"] = str(exc)
        check["actualAppUrl"] = actual_app_url
        return check

    check["actualAppUrl"] = normalized_actual
    origin_check = evaluate_origin_match(config_app_url, normalized_actual)
    check.update(origin_check)
    return check


def render_shell_command(args: List[str]) -> str:
    return " ".join(shlex.quote(arg) for arg in args)


def build_guarded_bootstrap_command(
    project_root: Path,
    actual_app_url: str,
    apply_recommended: bool,
) -> str:
    command = [
        "python3",
        str(Path(__file__).resolve().parent / "bootstrap_guarded.py"),
        "--project-root",
        str(project_root),
        "--actual-app-url",
        actual_app_url,
    ]
    if apply_recommended:
        command.append("--apply-recommended")
    command.append("--json")
    return render_shell_command(command)


def enrich_app_url_check(
    base_check: Dict[str, Any],
    project_root: Path,
    actual_app_url: Optional[str],
    recommended_actual_app_url: Optional[str],
    has_recommendations: bool,
    applied_recommendations: bool,
) -> Dict[str, Any]:
    check = dict(base_check)
    status = str(check.get("status"))
    actual_value = check.get("actualAppUrl") if isinstance(check.get("actualAppUrl"), str) else None
    needs_config_sync = bool(check.get("needsConfigSync"))
    can_auto_fix = bool(actual_value) and needs_config_sync

    command_actual_url = "<url>"
    if status in {"match", "mismatch"} and actual_value:
        command_actual_url = actual_value
    elif status == "not-provided" and isinstance(actual_app_url, str) and actual_app_url.strip():
        command_actual_url = actual_app_url.strip()
    elif status == "not-provided" and isinstance(recommended_actual_app_url, str) and recommended_actual_app_url.strip():
        command_actual_url = recommended_actual_app_url.strip()

    recommended_commands: List[Dict[str, Any]] = []
    recommended_command_set = set()

    def push_command(command_id: str, apply_fix: bool, description: str) -> None:
        command = build_guarded_bootstrap_command(
            project_root,
            command_actual_url,
            apply_recommended=apply_fix,
        )
        if command in recommended_command_set:
            return
        recommended_commands.append(
            {
                "id": command_id,
                "command": command,
                "description": description,
            }
        )
        recommended_command_set.add(command)

    if status in {"not-provided", "invalid-actual-url"}:
        push_command(
            "rerun-bootstrap-with-actual-url",
            apply_fix=False,
            description="Run guarded bootstrap with a valid --actual-app-url to evaluate origin match.",
        )
    elif status == "mismatch":
        if can_auto_fix and not applied_recommendations:
            push_command(
                "apply-recommended-app-url-fix",
                apply_fix=True,
                description=(
                    "Apply recommended appUrl/capture fixes first "
                    "(prevents repeated mismatch reruns)."
                ),
            )
        push_command(
            "verify-app-url-match",
            apply_fix=False,
            description="Re-run guarded bootstrap and confirm checks.appUrl.status=match.",
        )
    elif status == "match" and needs_config_sync and has_recommendations and not applied_recommendations:
        push_command(
            "optional-sync-app-url",
            apply_fix=True,
            description=(
                "Optional: sync config appUrl/loopback domains with --apply-recommended "
                "for deterministic future runs."
            ),
        )

    checklist = [
        {
            "id": "actual-app-url-provided",
            "pass": bool(actual_value),
            "detail": "Provide --actual-app-url during bootstrap. This is required for browser-fetch instrumentation mode.",
        },
        {
            "id": "actual-app-url-valid",
            "pass": status != "invalid-actual-url",
            "detail": "Ensure the actual URL is a valid http(s) URL.",
        },
        {
            "id": "app-url-origin-matches",
            "pass": status == "match",
            "detail": (
                "config.appUrl origin should match actual app origin used in reproduction "
                "(loopback localhost/127.0.0.1 equivalence is accepted)."
            ),
        },
    ]

    check["ok"] = status == "match"
    check["required"] = True
    check["recommendedActualAppUrl"] = recommended_actual_app_url
    check["checklist"] = checklist
    check["recommendedCommands"] = recommended_commands
    check["canAutoFix"] = can_auto_fix
    check["autoFixMode"] = "explicit-flag"
    if status in {"not-provided", "invalid-actual-url"}:
        check["nextAction"] = "provide-actual-app-url"
    elif status == "mismatch" and can_auto_fix and not applied_recommendations:
        check["nextAction"] = "apply-recommended"
    elif status == "mismatch":
        check["nextAction"] = "verify-match"
    elif status == "match" and needs_config_sync and has_recommendations and not applied_recommendations:
        check["nextAction"] = "optional-sync"
    else:
        check["nextAction"] = "none"
    return check


def build_recommendations(config: Dict[str, Any], actual_app_url: Optional[str]) -> Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, Any]]:
    recommended = copy.deepcopy(config)
    recommendations: List[Dict[str, Any]] = []

    app_url_check = evaluate_app_url_check(str(config["appUrl"]), actual_app_url)
    if bool(app_url_check.get("needsConfigSync")) and isinstance(app_url_check.get("actualAppUrl"), str):
        recommended["appUrl"] = app_url_check["actualAppUrl"]
        recommendation_type = "sync-app-url"
        recommendation_reason = "origin mismatch"
        if app_url_check.get("status") == "match":
            recommendation_type = "sync-app-url-loopback"
            recommendation_reason = "loopback canonicalization"
        recommendations.append(
            {
                "type": recommendation_type,
                "message": (
                    f"Sync appUrl from {config['appUrl']} to {app_url_check['actualAppUrl']} "
                    f"({recommendation_reason})"
                ),
                "from": config["appUrl"],
                "to": app_url_check["actualAppUrl"],
            }
        )

    loopback_reference = app_url_check.get("actualAppUrl") if app_url_check.get("actualAppUrl") else recommended["appUrl"]
    if is_loopback_url(str(loopback_reference)):
        allowed_domains = normalize_domains(list(recommended["capture"].get("allowedDomains", [])))
        missing = [domain for domain in LOOPBACK_DOMAINS if domain not in allowed_domains]
        if missing:
            allowed_domains.extend(missing)
            recommended["capture"]["allowedDomains"] = allowed_domains
            recommendations.append(
                {
                    "type": "add-loopback-domains",
                    "message": f"Add loopback domains to capture.allowedDomains: {', '.join(missing)}",
                    "added": missing,
                }
            )

    recommended = validate_config(recommended)
    return recommended, recommendations, app_url_check


def build_recommended_diff(config_path: Path, original_config: Dict[str, Any], recommended_config: Dict[str, Any]) -> str:
    original_text = json.dumps(original_config, indent=2, ensure_ascii=True) + "\n"
    recommended_text = json.dumps(recommended_config, indent=2, ensure_ascii=True) + "\n"

    if original_text == recommended_text:
        return ""

    diff = difflib.unified_diff(
        original_text.splitlines(keepends=True),
        recommended_text.splitlines(keepends=True),
        fromfile=str(config_path),
        tofile=str(config_path),
    )
    return "".join(diff)


def start_agent(plugin_root: Path, core_port: int, debug_port: int) -> None:
    env = os.environ.copy()
    env["CORE_PORT"] = str(core_port)
    env["DEBUG_PORT"] = str(debug_port)

    with open(os.devnull, "wb") as sink:
        subprocess.Popen(
            ["npm", "run", "agent:start"],
            cwd=str(plugin_root),
            env=env,
            stdout=sink,
            stderr=sink,
            start_new_session=True,
        )


def apply_runtime_config(core_base_url: str, config: Dict[str, Any]) -> Dict[str, Any]:
    response = http_request("POST", f"{core_base_url}/runtime/config", payload=config, timeout=3.0)
    if response.get("status") != 200:
        raise RuntimeError(
            f"Failed to apply runtime config: status={response.get('status')} body={response.get('body', '')[:500]}"
        )
    payload = response.get("json")
    if not isinstance(payload, dict):
        raise RuntimeError("Runtime config response is not valid JSON")
    return payload


def check_npx() -> Dict[str, Any]:
    npx_path = shutil.which("npx")
    if npx_path:
        return {"ok": True, "path": npx_path}
    return {"ok": False, "path": None, "reason": "npx command not found"}


def run_subprocess_smoke(command: List[str], timeout_seconds: float = 8.0) -> Dict[str, Any]:
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "exitCode": None,
            "reason": f"timeout after {timeout_seconds:.1f}s",
        }
    except OSError as exc:
        return {
            "ok": False,
            "exitCode": None,
            "reason": str(exc),
        }

    if completed.returncode == 0:
        return {
            "ok": True,
            "exitCode": 0,
            "reason": None,
        }

    stderr = (completed.stderr or "").strip()
    stdout = (completed.stdout or "").strip()
    reason = stderr or stdout or f"exit code {completed.returncode}"
    if len(reason) > 240:
        reason = f"{reason[:240]}..."

    return {
        "ok": False,
        "exitCode": completed.returncode,
        "reason": reason,
    }


def check_playwright_tool(npx_check: Dict[str, Any]) -> Dict[str, Any]:
    codex_home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
    wrapper_override = os.environ.get("PLAYWRIGHT_WRAPPER_PATH")
    wrapper_path = (
        Path(wrapper_override).expanduser()
        if wrapper_override
        else codex_home / "skills" / "playwright" / "scripts" / "playwright_cli.sh"
    )
    wrapper_exists = wrapper_path.exists()
    wrapper_executable = os.access(wrapper_path, os.X_OK)
    wrapper_smoke: Dict[str, Any] = {
        "ok": False,
        "exitCode": None,
        "reason": "Playwright wrapper not found",
    }

    if wrapper_exists and wrapper_executable:
        wrapper_smoke = run_subprocess_smoke([str(wrapper_path), "--help"])
    elif wrapper_exists:
        wrapper_smoke = {
            "ok": False,
            "exitCode": None,
            "reason": "Playwright wrapper exists but is not executable",
        }

    npx_smoke: Dict[str, Any] = {
        "ok": False,
        "exitCode": None,
        "reason": "npx command not found",
    }
    npx_command: Optional[List[str]] = None
    npx_binary: Optional[str] = None
    npx_path = str(npx_check.get("path")) if npx_check.get("path") else None
    if npx_check.get("ok") and npx_path:
        npx_primary = [npx_path, "--yes", "--package", "@playwright/mcp", "playwright-mcp", "--help"]
        primary_smoke = run_subprocess_smoke(npx_primary)
        if primary_smoke.get("ok"):
            npx_smoke = primary_smoke
            npx_command = npx_primary
            npx_binary = "playwright-mcp"
        else:
            npx_legacy = [npx_path, "--yes", "--package", "@playwright/mcp", "playwright-cli", "--help"]
            legacy_smoke = run_subprocess_smoke(npx_legacy)
            if legacy_smoke.get("ok"):
                npx_smoke = dict(legacy_smoke)
                npx_smoke["reason"] = "playwright-mcp probe failed; fallback to legacy playwright-cli succeeded"
                npx_command = npx_legacy
                npx_binary = "playwright-cli"
            else:
                reasons: List[str] = []
                if isinstance(primary_smoke.get("reason"), str):
                    reasons.append(f"playwright-mcp: {primary_smoke['reason']}")
                if isinstance(legacy_smoke.get("reason"), str):
                    reasons.append(f"playwright-cli: {legacy_smoke['reason']}")
                npx_smoke = {
                    "ok": False,
                    "exitCode": (
                        legacy_smoke.get("exitCode")
                        if legacy_smoke.get("exitCode") is not None
                        else primary_smoke.get("exitCode")
                    ),
                    "reason": "; ".join(reasons) if reasons else "npx probe failed",
                }
                npx_command = npx_primary

    if wrapper_smoke.get("ok"):
        selected_command = [str(wrapper_path), "--help"]
        return {
            "ok": True,
            "mode": "wrapper",
            "wrapperPath": str(wrapper_path),
            "wrapperExists": wrapper_exists,
            "wrapperExecutable": wrapper_executable,
            "wrapperSmoke": wrapper_smoke,
            "npxSmoke": npx_smoke,
            "selectedCommand": render_shell_command(selected_command),
            "selectedBinary": None,
            "reason": None,
        }

    if npx_smoke.get("ok"):
        wrapper_reason = wrapper_smoke.get("reason")
        if wrapper_exists and wrapper_executable:
            reason = "Playwright wrapper smoke check failed; fallback to npx succeeded"
        elif wrapper_exists and not wrapper_executable:
            reason = "Playwright wrapper is not executable; fallback to npx succeeded"
        else:
            reason = "Playwright wrapper missing; fallback to npx succeeded"
        if isinstance(wrapper_reason, str) and wrapper_reason:
            reason = f"{reason} ({wrapper_reason})"

        return {
            "ok": True,
            "mode": "npx-fallback",
            "wrapperPath": str(wrapper_path),
            "wrapperExists": wrapper_exists,
            "wrapperExecutable": wrapper_executable,
            "wrapperSmoke": wrapper_smoke,
            "npxSmoke": npx_smoke,
            "selectedCommand": render_shell_command(npx_command) if npx_command else None,
            "selectedBinary": npx_binary,
            "reason": reason,
        }

    wrapper_reason = wrapper_smoke.get("reason")
    npx_reason = npx_smoke.get("reason")
    reason_parts: List[str] = []
    if isinstance(wrapper_reason, str) and wrapper_reason:
        reason_parts.append(f"wrapper: {wrapper_reason}")
    if isinstance(npx_reason, str) and npx_reason:
        reason_parts.append(f"npx: {npx_reason}")

    return {
        "ok": False,
        "mode": "unavailable",
        "wrapperPath": str(wrapper_path),
        "wrapperExists": wrapper_exists,
        "wrapperExecutable": wrapper_executable,
        "wrapperSmoke": wrapper_smoke,
        "npxSmoke": npx_smoke,
        "selectedCommand": None,
        "selectedBinary": None,
        "reason": "; ".join(reason_parts) if reason_parts else "Playwright wrapper and npx probes failed",
    }


def probe_cdp(cdp_port: int) -> Dict[str, Any]:
    endpoint = f"http://127.0.0.1:{cdp_port}/json/version"
    response = http_request("GET", endpoint, timeout=0.5)
    if response.get("status") == 200 and isinstance(response.get("json"), dict):
        payload = response["json"]
        browser_value = payload.get("Browser")
        browser = str(browser_value) if isinstance(browser_value, str) else None
        user_agent_value = payload.get("User-Agent")
        user_agent = str(user_agent_value) if isinstance(user_agent_value, str) else None
        combined = " ".join(part for part in [browser, user_agent] if part).lower()
        return {
            "ok": True,
            "endpoint": endpoint,
            "browser": browser,
            "userAgent": user_agent,
            "headlessLikely": "headless" in combined,
            "reason": None,
        }
    if response.get("status") is not None:
        return {
            "ok": False,
            "endpoint": endpoint,
            "browser": None,
            "userAgent": None,
            "headlessLikely": None,
            "reason": f"HTTP_{response['status']}",
        }
    return {
        "ok": False,
        "endpoint": endpoint,
        "browser": None,
        "userAgent": None,
        "headlessLikely": None,
        "reason": response.get("error") or "unreachable",
    }


def probe_preflight(debug_endpoint: str, origin: str) -> Dict[str, Any]:
    response = http_request(
        "OPTIONS",
        debug_endpoint,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
        timeout=1.5,
    )

    allow_origin = str(response.get("headers", {}).get("access-control-allow-origin", ""))
    status = response.get("status")
    ok = status == 204 and allow_origin == origin

    reason = None
    if not ok:
        if status is None:
            reason = response.get("error") or "preflight request failed"
        elif status != 204:
            reason = f"expected 204, got {status}"
        else:
            reason = f"expected Access-Control-Allow-Origin={origin}, got {allow_origin or '<missing>'}"

    return {
        "ok": ok,
        "status": status,
        "origin": origin,
        "allowOrigin": allow_origin or None,
        "reason": reason,
    }


def probe_debug_post(debug_endpoint: str, origin: str, issue_tag: str) -> Dict[str, Any]:
    trace_id = str(uuid.uuid4())
    payload = {
        "marker": "BUGFIX_TRACE",
        "tag": issue_tag,
        "event": "bootstrap-probe",
        "traceId": trace_id,
        "ts": iso_now(),
        "data": {
            "source": "bootstrap",
            "origin": origin,
        },
    }

    response = http_request(
        "POST",
        debug_endpoint,
        payload=payload,
        headers={
            "Origin": origin,
            "Content-Type": "application/json",
        },
        timeout=2.0,
    )

    body_json = response.get("json")
    accepted = 0
    if isinstance(body_json, dict):
        accepted_raw = body_json.get("accepted")
        if isinstance(accepted_raw, int):
            accepted = accepted_raw

    status = response.get("status")
    ok = status in {200, 202} and accepted >= 1
    reason = None if ok else f"status={status}, accepted={accepted}"

    return {
        "ok": ok,
        "status": status,
        "accepted": accepted,
        "traceId": trace_id,
        "tag": issue_tag,
        "reason": reason,
    }


def probe_query(query_endpoint: str, trace_id: str, tag: str) -> Dict[str, Any]:
    from_ts = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat().replace("+00:00", "Z")
    to_ts = (datetime.now(timezone.utc) + timedelta(minutes=2)).isoformat().replace("+00:00", "Z")
    params = urlencode(
        {
            "from": from_ts,
            "to": to_ts,
            "tag": tag,
            "traceId": trace_id,
            "limit": 20,
        }
    )
    url = f"{query_endpoint}?{params}"

    last_status: Optional[int] = None
    for attempt in range(1, 4):
        response = http_request("GET", url, timeout=2.0)
        status = response.get("status")
        if isinstance(status, int):
            last_status = status
        body_json = response.get("json")

        if status == 200 and isinstance(body_json, dict):
            events = body_json.get("events", [])
            if isinstance(events, list):
                match = next(
                    (
                        event
                        for event in events
                        if isinstance(event, dict)
                        and event.get("traceId") == trace_id
                        and event.get("tag") == tag
                    ),
                    None,
                )
                if match:
                    return {
                        "ok": True,
                        "status": 200,
                        "matchedTraceId": trace_id,
                        "matchedTag": tag,
                        "attempt": attempt,
                        "reason": None,
                    }

        if attempt < 3:
            time.sleep(0.2)

    return {
        "ok": False,
        "status": last_status,
        "matchedTraceId": trace_id,
        "matchedTag": tag,
        "attempt": 3,
        "reason": (
            f"expected HTTP 200 from query endpoint, got {last_status}"
            if isinstance(last_status, int) and last_status != 200
            else "probe event not found in query window"
        ),
    }


def build_headed_evidence_check(cdp_check: Dict[str, Any]) -> Dict[str, Any]:
    if not bool(cdp_check.get("ok")):
        return {
            "required": True,
            "ok": False,
            "headlessLikely": None,
            "warning": "Unable to confirm headed browser mode from CDP probe; run at least one headed validation step.",
        }

    headless_likely = bool(cdp_check.get("headlessLikely"))
    if headless_likely:
        return {
            "required": True,
            "ok": False,
            "headlessLikely": True,
            "warning": "Headless browser detected. Do not treat black screenshots as final evidence; run headed validation.",
        }

    return {
        "required": True,
        "ok": True,
        "headlessLikely": False,
        "warning": None,
    }


def check_endpoint_unavailable(check: Dict[str, Any]) -> bool:
    status = check.get("status")
    if status is None:
        reason = check.get("reason")
        reason_text = str(reason).lower() if isinstance(reason, str) else ""
        keywords = [
            "connection",
            "refused",
            "timed out",
            "timeout",
            "unreachable",
            "name or service not known",
            "nodename nor servname provided",
        ]
        return any(keyword in reason_text for keyword in keywords)
    return isinstance(status, int) and status >= 500


def classify_instrumentation_failure(checks: Dict[str, Any]) -> Dict[str, Any]:
    failed_checks = [
        name
        for name in ["appUrl", "preflight", "debugPost", "query"]
        if not bool(checks.get(name, {}).get("ok"))
    ]

    if not failed_checks:
        return {
            "failedChecks": [],
            "category": "none",
            "reason": None,
        }

    app_url_check = checks.get("appUrl", {})
    app_status = str(app_url_check.get("status")) if isinstance(app_url_check, dict) else ""
    preflight_check = checks.get("preflight", {})
    debug_post_check = checks.get("debugPost", {})
    query_check = checks.get("query", {})

    if app_status == "mismatch":
        preflight_blocked = isinstance(preflight_check, dict) and preflight_check.get("status") == 403
        debug_blocked = isinstance(debug_post_check, dict) and debug_post_check.get("status") == 403
        if preflight_blocked or debug_blocked:
            return {
                "failedChecks": failed_checks,
                "category": "network-mismatch-only",
                "reason": (
                    "Actual app origin mismatches config and is blocked by debug endpoint CORS/allowlist checks. "
                    "Apply recommended appUrl sync before retrying instrumentation."
                ),
            }

    endpoint_unavailable = any(
        check_endpoint_unavailable(candidate)
        for candidate in [preflight_check, debug_post_check, query_check]
        if isinstance(candidate, dict)
    )
    if endpoint_unavailable:
        return {
            "failedChecks": failed_checks,
            "category": "endpoint-unavailable",
            "reason": (
                "Browser Debug endpoint appears unavailable (network/connection failure). "
                "Verify agent health, debug port, and endpoint reachability."
            ),
        }

    if app_status in {"not-provided", "invalid-actual-url"}:
        return {
            "failedChecks": failed_checks,
            "category": "app-url-gate",
            "reason": "Actual app URL gate is unresolved. Provide valid --actual-app-url and rerun bootstrap.",
        }

    return {
        "failedChecks": failed_checks,
        "category": "mixed-check-failures",
        "reason": f"Failed checks: {', '.join(failed_checks)}",
    }


def bootstrap(
    project_root: Path,
    plugin_root_arg: Optional[str],
    actual_app_url: Optional[str],
    apply_recommended: bool,
) -> Dict[str, Any]:
    plugin_root = resolve_plugin_root(plugin_root_arg)
    project_config_path, raw_config, _created = ensure_project_config(project_root)
    config = validate_config(raw_config)
    original_config = copy.deepcopy(config)

    recommended_config, recommendations, app_url_check = build_recommendations(config, actual_app_url)
    recommended_diff = build_recommended_diff(project_config_path, original_config, recommended_config)

    active_config = config
    applied_recommendations = False
    if apply_recommended and recommendations:
        project_config_path.write_text(
            json.dumps(recommended_config, indent=2, ensure_ascii=True) + "\n",
            encoding="utf-8",
        )
        active_config = recommended_config
        applied_recommendations = True
    elif recommendations:
        active_config = config

    host = str(active_config["agent"]["host"])
    core_port = int(active_config["agent"]["corePort"])
    debug_port = int(active_config["agent"]["debugPort"])
    cdp_port = int(active_config["browser"]["cdpPort"])

    core_base_url = f"http://{host}:{core_port}"
    debug_endpoint = f"http://{host}:{debug_port}/debug"
    query_endpoint = f"{core_base_url}/events/query"

    health = check_health(core_base_url)
    if not health:
        start_agent(plugin_root, core_port=core_port, debug_port=debug_port)
        health = wait_for_health(core_base_url)

    if not health:
        raise RuntimeError(
            f"Agent did not become healthy at {core_base_url}. Check npm dependencies and running processes."
        )

    apply_runtime_config(core_base_url, active_config)

    effective_app_url = str(active_config["appUrl"])
    recommended_actual_app_url: Optional[str] = None
    active_session = health.get("activeSession")
    if isinstance(active_session, dict):
        session_tab_url = active_session.get("tabUrl")
        if isinstance(session_tab_url, str) and session_tab_url.strip():
            try:
                recommended_actual_app_url = canonicalize_url(session_tab_url)
            except RuntimeError:
                recommended_actual_app_url = session_tab_url

    app_url_check = enrich_app_url_check(
        evaluate_app_url_check(effective_app_url, actual_app_url),
        project_root=project_root,
        actual_app_url=actual_app_url,
        recommended_actual_app_url=recommended_actual_app_url,
        has_recommendations=bool(recommendations),
        applied_recommendations=applied_recommendations,
    )
    instrumentation_origin = get_origin(
        app_url_check["actualAppUrl"] if isinstance(app_url_check.get("actualAppUrl"), str) else effective_app_url
    )

    preflight_check = probe_preflight(debug_endpoint, instrumentation_origin)

    issue_tag = "bootstrap-probe"
    debug_post_check = probe_debug_post(debug_endpoint, instrumentation_origin, issue_tag)

    if debug_post_check["ok"]:
        query_check = probe_query(
            query_endpoint,
            trace_id=str(debug_post_check["traceId"]),
            tag=str(debug_post_check["tag"]),
        )
    else:
        query_check = {
            "ok": False,
            "status": None,
            "matchedTraceId": None,
            "matchedTag": None,
            "attempt": 0,
            "reason": "skipped because debugPost failed",
        }

    npx_check = check_npx()
    playwright_check = check_playwright_tool(npx_check)
    cdp_check = probe_cdp(cdp_port)
    headed_evidence_check = build_headed_evidence_check(cdp_check)

    checks: Dict[str, Any] = {
        "appUrl": app_url_check,
        "preflight": preflight_check,
        "debugPost": debug_post_check,
        "query": query_check,
        "headedEvidence": headed_evidence_check,
        "tools": {
            "npx": npx_check,
            "playwright": playwright_check,
            "cdp": cdp_check,
        },
    }

    warnings: List[Dict[str, str]] = []
    if isinstance(headed_evidence_check.get("warning"), str) and headed_evidence_check["warning"]:
        warnings.append(
            {
                "id": "headed-evidence-required",
                "message": str(headed_evidence_check["warning"]),
            }
        )
    if warnings:
        checks["warnings"] = warnings

    instrumentation_failure = classify_instrumentation_failure(checks)
    failed_checks = instrumentation_failure["failedChecks"]
    can_instrument_from_browser = len(failed_checks) == 0

    browser_instrumentation = {
        "canInstrumentFromBrowser": can_instrument_from_browser,
        "mode": "browser-fetch" if can_instrument_from_browser else "terminal-probe",
        "failureCategory": None if can_instrument_from_browser else instrumentation_failure["category"],
        "failedChecks": failed_checks,
        "reason": instrumentation_failure["reason"],
    }

    return {
        "pluginRoot": str(plugin_root),
        "projectConfigPath": str(project_config_path),
        "appUrl": effective_app_url,
        "recommendedActualAppUrl": recommended_actual_app_url,
        "coreBaseUrl": core_base_url,
        "debugEndpoint": debug_endpoint,
        "queryEndpoint": query_endpoint,
        "cdpPort": cdp_port,
        "checks": checks,
        "browserInstrumentation": browser_instrumentation,
        "recommendations": recommendations,
        "recommendedDiff": recommended_diff,
        "appliedRecommendations": applied_recommendations,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap Browser Debug plugin for fix-app-bugs skill")
    parser.add_argument("--project-root", default=os.getcwd(), help="Target project root (default: cwd)")
    parser.add_argument("--plugin-root", default=None, help="Browser Debug plugin root path")
    parser.add_argument("--actual-app-url", default=None, help="Actual app URL used during reproduction")
    parser.add_argument(
        "--apply-recommended",
        action="store_true",
        help="Apply recommended config updates (appUrl sync and loopback domains)",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON output")

    args = parser.parse_args()

    try:
        result = bootstrap(
            Path(args.project_root).expanduser().resolve(),
            args.plugin_root,
            args.actual_app_url,
            args.apply_recommended,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"bootstrap_browser_debug.py failed: {exc}", file=sys.stderr)
        return 1

    if args.json:
        print(json.dumps(result, ensure_ascii=True))
    else:
        print("Browser Debug bootstrap complete")
        for key in [
            "pluginRoot",
            "projectConfigPath",
            "appUrl",
            "coreBaseUrl",
            "debugEndpoint",
            "queryEndpoint",
            "cdpPort",
            "appliedRecommendations",
        ]:
            print(f"- {key}: {result[key]}")
        print(f"- browserInstrumentation: {json.dumps(result['browserInstrumentation'], ensure_ascii=True)}")
        print(f"- recommendations: {json.dumps(result['recommendations'], ensure_ascii=True)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

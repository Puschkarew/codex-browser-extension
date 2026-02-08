# Browser Debug Plugin

## What This Project Is
This repository contains a local browser debugging toolkit for reproducible frontend investigations.
It combines a Chrome MV3 extension, a local Node.js agent, and JSONL log storage to capture runtime evidence, run browser actions, and query traces by time window.

## Who It Is For
- Developers who need reliable runtime evidence for frontend bug investigations.
- AI agents that must follow deterministic debugging workflows and strict instrumentation gates.

## Architecture
- `extensions/humans-debugger`: MV3 extension (background service worker, popup, content script).
- `src/agent`: local Fastify-based agent with Core API (`4678` by default) and Debug API (`7331` by default).
- `logs/browser-debug`: local JSONL event storage and screenshot artifacts.

## How It Works
1. The extension discovers an available Core API on `127.0.0.1` (ports `4678..4698`) and syncs runtime config.
2. A session starts for the active tab through `/session/start`; the agent attaches to Chrome DevTools Protocol (CDP).
3. The content script captures runtime signals (console, errors, unhandled rejections, fetch/XHR network events).
4. Events are ingested through `/events` (session + ingest token) or `/debug` (`BUGFIX_TRACE` payloads).
5. The agent normalizes payloads, redacts sensitive data, writes JSONL logs, and stores snapshots.
6. Operators query logs via `/events/query` or `npm run agent:query`, and run CDP commands via `/command` or `npm run agent:cmd`.

## Quick Start
1. Install dependencies:
```bash
npm install
```
2. Start the local agent:
```bash
npm run agent:start
```
3. Start Chrome with CDP enabled:
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```
4. Open `chrome://extensions`, enable Developer mode, then load unpacked extension from:
```text
extensions/humans-debugger
```

## Runtime Configuration
Each target project can provide `.codex/browser-debug.json`:

```json
{
  "version": 1,
  "projectId": "my-project",
  "appUrl": "http://localhost:5173",
  "agent": {
    "host": "127.0.0.1",
    "corePort": 4678,
    "debugPort": 7331
  },
  "browser": {
    "cdpPort": 9222
  },
  "capture": {
    "allowedDomains": ["localhost", "127.0.0.1"],
    "networkAllowlist": []
  },
  "defaults": {
    "queryWindowMinutes": 30
  }
}
```

## Core Commands
- Start agent: `npm run agent:start`
- Stop active session: `npm run agent:stop`
- Execute a browser command: `npm run agent:cmd -- --session <id> --do <reload|click|type|snapshot>`
- Query logs: `npm run agent:query -- --from <ISO> --to <ISO> [--tag <tag>]`
- Run tests: `npm test`

Examples:
```bash
npm run agent:cmd -- --session <id> --do reload
npm run agent:cmd -- --session <id> --do click --selector "button[data-test=save]"
npm run agent:cmd -- --session <id> --do type --selector "input[name=email]" --text "user@example.com" --clear
npm run agent:cmd -- --session <id> --do snapshot --fullPage
```

## HTTP APIs
Default base URLs:
- Core API: `http://127.0.0.1:4678`
- Debug API: `http://127.0.0.1:7331`

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/health` | `GET` | Agent status, active session, readiness (including CDP probe). |
| `/runtime/config` | `GET`, `POST` | Read or update active runtime config. |
| `/session/start` | `POST` | Start session and attach to tab via CDP. |
| `/session/stop` | `POST` | Stop current session and detach CDP. |
| `/events` | `POST` | Ingest extension runtime events (requires `X-Ingest-Token`). |
| `/events/query` | `GET` | Query JSONL events by time window and filters. |
| `/command` | `POST` | Execute CDP command (`reload`, `click`, `type`, `snapshot`). |
| `/debug` | `OPTIONS`, `POST` | Preflight + `BUGFIX_TRACE` ingestion with origin allowlist checks. |

## Privacy and Safety
- The agent binds to loopback (`127.0.0.1`) by default and is intended for local debugging.
- Domain and origin allowlists gate session start and `/debug` ingestion.
- Sensitive values are redacted before persistence (email, bearer/JWT-like tokens, cards, secret-like keys).
- Request body capture is rule-based and byte-limited through `capture.networkAllowlist`.

## Troubleshooting
- `CDP_UNAVAILABLE`: verify Chrome was started with `--remote-debugging-port=9222` and that `browser.cdpPort` matches.
- `TARGET_NOT_FOUND`: ensure the active tab URL matches the requested `tabUrl` pattern.
- `DOMAIN_NOT_ALLOWED` / `ORIGIN_NOT_ALLOWED` / `CORS_POLICY_BLOCKED_PATH`: update `capture.allowedDomains` and refresh runtime config.
- `SESSION_ALREADY_RUNNING`: stop the active session first (`npm run agent:stop` or `/session/stop`).

Quick check:
```bash
curl http://127.0.0.1:4678/health
```

## Documentation Map
- Advanced operational runbook: [README-debug.md](README-debug.md)
- AI-agent workflow rules: [AGENTS.md](AGENTS.md)

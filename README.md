# Browser Debug Plugin

## What This Project Is
This repository contains a local browser debugging toolkit for reproducible frontend investigations.
It combines a Chrome MV3 extension, a local Node.js agent, and JSONL log storage to capture runtime evidence, run browser actions, and query traces by time window.

## Operating Modes

| Dimension | Core mode | Enhanced mode (fix-app-bugs optional addon) |
| --- | --- | --- |
| Goal | Fast local debugging with direct extension + agent workflow. | Strict, machine-verifiable bugfix workflow with guarded instrumentation decisions. |
| Required tools | Node.js, Chrome with CDP, extension. | Core mode tools + `fix-app-bugs` skill scripts. |
| Required bootstrap | No guarded bootstrap required. | Guarded bootstrap required before evidence collection decisions. |
| Evidence/report strictness | Standard debugging evidence; report format is optional. | Strict evidence mode, cleanup checks, and required final report blocks. |
| Best for | Manual investigation, local iteration, general diagnostics. | Reproducible bugfix runs with explicit instrumentation gates and auditability. |

`Core mode` is the default and does not require `fix-app-bugs`.
`Enhanced mode (fix-app-bugs optional addon)` adds guarded bootstrap, strict evidence, and cleanup/report discipline.

## Who It Is For
- Developers who need reliable runtime evidence for frontend bug investigations.
- AI agents that must follow deterministic debugging workflows.

## Architecture
- `extensions/humans-debugger`: MV3 extension (background service worker, popup, content script).
- `src/agent`: local Fastify-based agent with Core API (`4678` by default) and Debug API (`7331` by default).
- `logs/browser-debug`: local JSONL event storage and screenshot artifacts.

Mode note: runtime architecture is identical in both modes; Enhanced mode adds external workflow controls on top.

## How It Works
1. The extension discovers an available Core API on `127.0.0.1` (ports `4678..4698`) and syncs runtime config.
2. A session starts for the active tab through `/session/start`; the agent attaches to Chrome DevTools Protocol (CDP).
3. The content script captures runtime signals (console, errors, unhandled rejections, fetch/XHR network events).
4. Events are ingested through `/events` (session + ingest token) or `/debug` (`BUGFIX_TRACE` payloads).
5. The agent normalizes payloads, redacts sensitive data, writes JSONL logs, and stores snapshots.
6. Operators query logs via `/events/query` or `npm run agent:query`, and run CDP commands via `/command` or `npm run agent:cmd`.

Mode note: Enhanced mode gates instrumentation decisions through guarded bootstrap; Core mode can operate directly.

## Quick Start (Core mode)
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

## Quick Start (Enhanced mode, optional)
1. Complete all Core mode steps first.
2. Ensure `CODEX_HOME` is set:
```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
```
3. Run guarded bootstrap for target project:
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --json
```
4. Re-run with the real app URL (required for browser-fetch mode):
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --actual-app-url <url> --json
```

Bootstrap notes:
- Loopback origins `localhost` and `127.0.0.1` are treated as equivalent for capability checks.
- `checks.appUrl.recommendedCommands` now prioritizes `--apply-recommended` on mismatch to avoid rerun loops.
- Inspect `browserInstrumentation.failureCategory` to distinguish `network-mismatch-only` vs `endpoint-unavailable`.

If guarded bootstrap falls back or Enhanced prerequisites are unavailable, continue in Core mode.

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

## Mode Selection Guidance
- Choose `Core mode` for local/manual debugging and fast iteration.
- Choose `Enhanced mode (fix-app-bugs optional addon)` when you need strict reproducibility, explicit instrumentation gates, and machine-verifiable bugfix reporting.

## Workflow Auto Routing (Every Skills)

Workflow and reviewer skills can auto-route into Browser Debug + `fix-app-bugs` based on a shared contract.

Source-of-truth and mirrors:
- Local: `$CODEX_HOME/skills/workflows-shared/references/auto-routing-contract.md`
- Local capability map: `$CODEX_HOME/skills/workflows-shared/references/auto-routing-capability-map.md`
- Repo mirrors:
  - `docs/contracts/auto-routing-contract.md`
  - `docs/contracts/auto-routing-capability-map.md`

Routing guardrails:
1. `EVERY_AUTO_ROUTING_ENABLED=false` disables all auto-routing.
2. Session opt-out tokens (`no-auto-routing`, `manual-only`, `skip-browser-debug`) force `no-route`.
3. `Core mode` remains default; `Enhanced` is used only for strict reproducibility.
4. Fallback verdicts force `terminal-probe`, with no browser-side `fetch(debugEndpoint)` usage.

### Quick Decision Tree
1. Start with `Core mode` for exploratory debugging and fast command loops.
2. Move to `Enhanced mode` when you need guarded bootstrap verdicts and strict final reports.
3. If `Enhanced` returns `bootstrap.status = fallback` or `canInstrumentFromBrowser = false`, use `terminal-probe` immediately.
4. For parity-sensitive work, capture one artifact bundle per checkpoint and keep headed evidence.
5. If parity does not improve after 3 cycles or 90 minutes, stop and switch to rollback/retrospective planning.

## Core Commands
These commands are valid in both modes:
- Start agent: `npm run agent:start`
- Stop active session: `npm run agent:stop`
- Execute a browser command: `npm run agent:cmd -- --session <id> --do <reload|click|type|snapshot|compare-reference|webgl-diagnostics>`
- Capture one parity bundle: `npm run agent:parity-bundle -- --session <id> --reference /path/ref.png --label baseline`
- Query logs: `npm run agent:query -- --from <ISO> --to <ISO> [--tag <tag>]`
- Run tests: `npm test`

Examples:
```bash
npm run agent:cmd -- --session <id> --do reload
npm run agent:cmd -- --session <id> --do click --selector "button[data-test=save]"
npm run agent:cmd -- --session <id> --do type --selector "input[name=email]" --text "user@example.com" --clear
npm run agent:cmd -- --session <id> --do snapshot --fullPage
npm run agent:cmd -- --session <id> --do compare-reference --actual /path/app.png --reference /path/ref.png --label baseline
npm run agent:parity-bundle -- --session <id> --reference /path/ref.png --label baseline
npm run agent:cmd -- --session <id> --do webgl-diagnostics
```

Enhanced fallback helper (terminal-probe scenario pipeline):
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/terminal_probe_pipeline.py" --project-root <project-root> --session-id <id> --scenarios "$CODEX_HOME/skills/fix-app-bugs/references/terminal-probe-scenarios.example.json" --json
```
This helper captures scenario snapshots, computes metrics (`mean`, `stddev`, `nonBlackRatio`, `MAE`), and writes `runtime.json`, `metrics.json`, `summary.json`.

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
| `/command` | `POST` | Execute command (`reload`, `click`, `type`, `snapshot`, `compare-reference`, `webgl-diagnostics`). |
| `/debug` | `OPTIONS`, `POST` | Preflight + `BUGFIX_TRACE` ingestion with origin allowlist checks. |

Mode note: API surface stays the same in both modes; Enhanced mode imposes stricter workflow rules around when and how instrumentation is used.

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
- `browserInstrumentation.failureCategory = network-mismatch-only`: apply first `checks.appUrl.recommendedCommands` entry with `--apply-recommended`.
- `browserInstrumentation.failureCategory = endpoint-unavailable`: verify agent health and endpoint reachability before retrying browser-fetch.
- Missing `fix-app-bugs` tooling is not a blocker for Core mode; run Core workflow directly.

## Skill Sync Workflow

Local skill is the source of truth:
`$CODEX_HOME/skills/fix-app-bugs` (fallback: `$HOME/.codex/skills/fix-app-bugs`).

Keep repository mirror in sync:
1. Sync local -> repo mirror:
```bash
npm run skill:sync:from-local
```
2. Verify sync before commit/push:
```bash
npm run skill:sync:check
```
3. Optional repo -> local sync:
```bash
npm run skill:sync:to-local
```

Auto-routing contract mirror workflow:
1. Sync local -> repo mirror:
```bash
npm run routing:sync:from-local
```
2. Verify sync before commit/push:
```bash
npm run routing:sync:check
```
3. Optional repo -> local sync:
```bash
npm run routing:sync:to-local
```

Quick check:
```bash
curl http://127.0.0.1:4678/health
```

## Documentation Map
- Core onboarding and dual-mode entrypoint: [README.md](README.md)
- Enhanced deep runbook: [README-debug.md](README-debug.md)
- Mode-gated AI workflow policy: [AGENTS.md](AGENTS.md)

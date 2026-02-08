# AGENTS.md

## Mission
Use this repository to collect reproducible browser runtime evidence, run controlled browser actions, and support deterministic bugfix workflows for human developers and AI agents.

## Repository Layout
- `extensions/humans-debugger`: MV3 extension (background, popup, content instrumentation).
- `src/agent`: local Node.js agent (Core API + Debug API).
- `src/cli`: command-line helpers for command execution, querying, and stopping sessions.
- `src/shared/contracts.ts`: request/response schemas and shared types.
- `config`: default allowlist and network capture rules.
- `logs/browser-debug`: JSONL logs and snapshot artifacts.

## Standard Workflow
1. Install dependencies:
```bash
npm install
```
2. Start the agent:
```bash
npm run agent:start
```
3. Start Chrome with CDP enabled:
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```
4. Load unpacked extension from:
```text
extensions/humans-debugger
```
5. Ensure `CODEX_HOME` is set (default to `~/.codex` when missing):
```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
```
6. Run guarded bootstrap for target project:
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --json
```
7. If the real app URL is known:
```bash
python3 "$CODEX_HOME/skills/fix-app-bugs/scripts/bootstrap_guarded.py" --project-root <project-root> --actual-app-url <url> --json
```

## Instrumentation Gate
Always branch behavior from guarded bootstrap output.

1. Browser instrumentation is allowed only when `browserInstrumentation.canInstrumentFromBrowser = true`.
2. If `false` or `bootstrap.status = fallback`, switch to `terminal-probe` mode.
3. In `terminal-probe` mode, do not add page-side `fetch(debugEndpoint)` calls.
4. If `checks.appUrl.status = mismatch`, use `checks.appUrl.checklist` and `checks.appUrl.recommendedCommands`.
5. `checks.appUrl.autoFixMode` must stay explicit-flag only (`--apply-recommended`).
6. Read Playwright diagnostics from `checks.tools.playwright.wrapperSmoke` and `checks.tools.playwright.npxSmoke`.

## Operating Modes
### Browser instrumentation mode
- Use extension or `/debug` instrumentation when gate conditions permit it.
- Keep evidence tied to reproduction windows, tags, and trace IDs.

### Terminal-probe mode
- Use CLI/API-only probing and command execution.
- Do not inject new page-side debug ingestion calls.
- Treat guarded bootstrap fallback as authoritative.

## Approved Commands
- Start agent: `npm run agent:start`
- Stop current session: `npm run agent:stop`
- Query events by window:
```bash
npm run agent:query -- --from <ISO> --to <ISO> --tag <tag>
```
- Execute browser command:
```bash
npm run agent:cmd -- --session <id> --do reload
npm run agent:cmd -- --session <id> --do click --selector "button[data-test=save]"
npm run agent:cmd -- --session <id> --do type --selector "input[name=email]" --text "user@example.com" --clear
npm run agent:cmd -- --session <id> --do snapshot --fullPage
```
- Run tests: `npm test`

## Cleanup and Evidence Rules
Run guarded cleanup after bugfix work:

```bash
bash "$CODEX_HOME/skills/fix-app-bugs/scripts/cleanup_guarded.sh" .
```

Strict mode:

```bash
bash "$CODEX_HOME/skills/fix-app-bugs/scripts/cleanup_guarded.sh" . --strict
```

Notes:
- Strict mode scans runtime code paths and should ignore markdown-only feedback mentions.
- If cleanup tooling is unavailable, use fallback scan:
```bash
rg -n "BUGFIX_TRACE|debugEndpoint|traceId|issue tag" src test
```

## Required Final Report Format
Every `fix-app-bugs` run must end with these blocks, in this order:
1. `Root Cause`
2. `Patch`
3. `Validation`
4. `Instrumentation Status`
5. `Residual Risk`

If guarded bootstrap fell back, state it explicitly in `Validation`.

## Guardrails
- Never add page-side `fetch(debugEndpoint)` instrumentation in `terminal-probe` mode.
- For WebGL/render bugs, do not treat black headless screenshots as sole proof.
- Declare success only with browser-visible confirmation or concrete runtime errors.

## Notes for Contributors
- Keep commands aligned with `package.json` scripts and current API contracts.
- Prefer deterministic, machine-readable outputs for automation steps.
- When changing workflows, update both `README.md` and `README-debug.md`.

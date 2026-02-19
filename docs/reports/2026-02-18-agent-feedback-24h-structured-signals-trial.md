---
date: 2026-02-18
topic: agent-feedback-structured-signals-trial
source_plan: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/plans/2026-02-18-feat-plugin-skill-collaboration-readiness-loop-plan.md
schema_version: 2026-02-18-feedback-signals-v1
json_artifact: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-18-agent-feedback-24h-structured-signals-trial.json
---

# 24h Structured Signals Trial (Plugin + fix-app-bugs)

## Scope
- Validate the new structured feedback schema from `agent:feedback`.
- Run one 24-hour trial cycle for targets `browser-debug,fix-app-bugs`.
- Confirm backlog slice can be produced directly from `signals` + `backlogSlice`.

## Routing Trace
- `triggerMatched`: false
- `triggerClass`: non-runtime
- `ruleId`: R5-NO-ROUTE
- `autoInvoked`: false
- `modeSelected`: core
- `fallbackUsed`: false
- `killSwitchState`: enabled

## Trial Command
```bash
npm run -s agent:feedback -- --window 24h --targets browser-debug,fix-app-bugs --json
```

Execution latency:
- `durationMs`: `368`
- `retryCount`: `0` (single-pass analysis flow)

Window:
- `windowStartUtc`: `2026-02-17T17:13:17.893Z`
- `windowEndUtc`: `2026-02-18T17:13:17.893Z`
- `scannedFiles`: `12`
- `relevantSessions`: `11`

## Structured Signal Summary
Schema version:
- `2026-02-18-feedback-signals-v1`

Detected signals:
1. `signal-1`
- `issueId`: `appurl_mismatch_terminal_probe`
- `area`: `shared`
- `signalType`: `explicit`
- `confidence`: `high`
- `priorityHint`: `p0`
- `count`: `6`

Top evidence refs:
- `/Users/vladimirpuskarev/.codex/sessions/2026/02/17/rollout-2026-02-17T20-08-35-019c6c93-420a-7d33-9f20-943cd2325241.jsonl`
- `/Users/vladimirpuskarev/.codex/sessions/2026/02/17/rollout-2026-02-17T22-01-03-019c6cfa-36c5-7551-adaf-d2a712a94305.jsonl`

## Backlog Slice (Trial)
- `[P0] appurl_mismatch_terminal_probe` — appUrl mismatch forces terminal-probe fallback.

## Cadence Decision
Decision for Phase 4:
- Keep feedback triage **manual/on-demand** as default for now.
- Promote to scheduled automation only after at least 3 consecutive daily windows demonstrate stable signal quality and non-trivial backlog deltas.

Rationale:
- Current trial produced a clear prioritized signal quickly.
- A single-day window is useful but insufficient to justify automatic recurring runs.

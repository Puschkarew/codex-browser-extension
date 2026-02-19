# Live CDP Navigate Stress 10x (2026-02-19)

- mode: Core mode (live Chrome/CDP + live agent runtime)
- objective: verify `navigate` stability and absence of `readyState 3 (CLOSED)` across stress cycles
- scenarios file: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-scenarios.json`
- agent health snapshot: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-health.json`
- CDP version snapshot: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-cdp-version.json`

## Runs
- run-1: ok=`True`, scenarios=`10`, failed=`0`
  - lifecycle: ensureAttempts=`1`, firstEnsureAttemptSucceeded=`True`, fallbackUsed=`True`, attachBranch=`preflight-resolve-target-from-cdp-list`
  - runtime: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-fresh-agent-run/runtime.json`
  - metrics: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-fresh-agent-run/metrics.json`
  - summary: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-fresh-agent-run/summary.json`
- run-2: ok=`True`, scenarios=`10`, failed=`0`
  - lifecycle: ensureAttempts=`1`, firstEnsureAttemptSucceeded=`True`, fallbackUsed=`True`, attachBranch=`preflight-resolve-target-from-cdp-list`
  - runtime: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-fresh-agent-run-2/runtime.json`
  - metrics: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-fresh-agent-run-2/metrics.json`
  - summary: `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/reports/2026-02-19-live-cdp-navigate-stress-10x-fresh-agent-run-2/summary.json`

## Aggregate
- totalScenarios: `20`
- totalFailedScenarios: `0`
- passRate: `100.0%`
- readyState 3 (CLOSED) matches: `0`

## Verdict
- Live stress validation passed for the executed runs with zero `readyState 3 (CLOSED)` occurrences in runtime artifacts.

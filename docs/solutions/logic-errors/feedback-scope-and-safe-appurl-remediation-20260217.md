---
module: browser-debug-plugin
date: 2026-02-17
problem_type: logic_error
component: analytics-and-health-remediation
symptoms:
  - "`agent:feedback --targets <value>` reported issue counts from messages outside requested targets"
  - "`/health.appUrlDrift.recommendedCommand` embedded runtime process cwd as `--project-root`, unsafe in cross-project flows"
root_cause: logic_error
resolution_type: code_fix
severity: medium
tags: [analytics, feedback, appurl, remediation, runtime, safety, tests]
---

# Troubleshooting: Fix Target-Scoped Feedback Aggregation and Safe Health Remediation Commands

## Problem
Two issues surfaced after introducing the new agent feedback analytics and `/health.appUrlDrift` remediation hints:
1. Target scoping was inconsistent in analytics aggregation.
2. Health remediation command generation was convenient but not context-safe.

## Environment
- Module: Browser Debug plugin
- Affected components:
  - `src/cli/feedback.ts`
  - `src/agent/runtime.ts`
- Related docs:
  - `README.md`
  - `README-debug.md`

## Symptoms
- Running `npm run agent:feedback -- --window 24h --targets nonexistent-target --json` still returned non-empty `issues`.
- `/health.appUrlDrift.recommendedCommand` could suggest running bootstrap with a project root unrelated to the target app repo.

## What Didn't Work

**Attempted behavior 1:** Use target matching only for `relevantHits`.
- **Why it failed:** issue pattern aggregation still ran for all messages, so filtered reports remained noisy/misleading.

**Attempted behavior 2:** Build copy-ready remediation command from runtime root directory.
- **Why it failed:** runtime root (`process.cwd()` of the agent) is not guaranteed to be the target app project in multi-repo workflows.

## Solution

### 1) Enforce target scope before issue aggregation

**Code changes:**
```ts
// src/cli/feedback.ts
const targetMatched = targetPattern.test(text);
if (targetMatched) {
  relevantHits += 1;
}

if (!targetMatched) {
  continue;
}

for (const issue of ISSUE_DEFINITIONS) {
  // issue counting now scoped to target-matched messages only
}
```

Result: `--targets` now consistently controls both session relevance and issue extraction.

### 2) Make `/health` remediation command context-safe

**Code changes:**
```ts
// src/agent/runtime.ts
function buildBootstrapRemediationCommand(activeSessionTabUrl: string): string {
  return (
    "python3 \"${CODEX_HOME:-$HOME/.codex}/skills/fix-app-bugs/scripts/bootstrap_guarded.py\"" +
    " --project-root <project-root>" +
    ` --actual-app-url ${shellQuote(activeSessionTabUrl)}` +
    " --apply-recommended --json"
  );
}
```

Result: remediation remains actionable, but no longer risks silently targeting the wrong repository path.

### 3) Add regression tests

- `tests/feedback.test.ts`
  - Verifies non-matching `--targets` yields `relevantSessions=0` and empty `issues`.
- `tests/app-url-drift.test.ts`
  - Verifies remediation command uses `--project-root <project-root>` placeholder.
  - Verifies `no-active-session` returns `recommendedCommand: null`.

## Validation
Commands run:
```bash
python3 skills/fix-app-bugs/scripts/test_bootstrap_browser_debug.py
python3 skills/fix-app-bugs/scripts/test_visual_debug_start.py
python3 skills/fix-app-bugs/scripts/test_bootstrap_guarded.py
npm test
npm run agent:feedback -- --window 24h --targets nonexistent-target --json
```

Observed outcome:
- All tests passed.
- Target-scoped feedback command now returns empty `issues` for unrelated targets.

## Why This Works
1. The analytics contract is now internally consistent: filtering and counting use the same scope gate.
2. The health remediation hint now prefers safe explicitness over implicit path inference.
3. Regression tests lock both behaviors and reduce future drift.

## Prevention
- For any CLI filter feature, enforce a single gate for all downstream aggregates.
- Avoid embedding mutable environment context (like process cwd) into commands that can modify project config.
- Add a dedicated test whenever user-visible machine-readable contract fields are introduced.

## Related Documentation
- `docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`
- `docs/plans/2026-02-17-feat-agent-feedback-backlog-roadmap-plan.md`
- `docs/reports/2026-02-17-agent-feedback-24h-plugin-fix-app-bugs.md`
- `todos/004-complete-p2-feedback-target-filter-not-enforced.md`
- `todos/005-complete-p2-health-appurl-remediation-uses-runtime-root.md`

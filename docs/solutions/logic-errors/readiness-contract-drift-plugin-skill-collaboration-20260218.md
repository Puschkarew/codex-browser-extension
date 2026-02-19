---
module: browser-debug-plugin
date: 2026-02-18
problem_type: logic_error
component: tooling
symptoms:
  - "Plugin popup showed connectivity/session state but no canonical run verdict, forcing manual interpretation"
  - "`/health`, starter output, and popup used different readiness vocabularies, which increased retry loops"
  - "`agent:feedback --json` lacked structured signal metadata for deterministic shared backlog triage"
root_cause: logic_error
resolution_type: workflow_improvement
severity: medium
tags: [readiness, fallback, recovery-lane, feedback-signals, plugin, fix-app-bugs]
---

# Troubleshooting: Unify Run Readiness, Recovery Precedence, and Feedback Signals Across Plugin + fix-app-bugs

## Problem
The Browser Debug plugin and `fix-app-bugs` starter had the right primitives, but they did not expose a single operator-facing contract for "can I run now?". This caused split-brain readiness interpretation across popup state, `/health`, and starter JSON, plus slower shared prioritization after runs.

## Environment
- Module: Browser Debug plugin + fix-app-bugs workflow surfaces
- Affected components:
  - `src/agent/runtime.ts`
  - `extensions/humans-debugger/background.js`
  - `extensions/humans-debugger/popup.js`
  - `extensions/humans-debugger/popup.html`
  - `skills/fix-app-bugs/scripts/visual_debug_start.py`
  - `src/cli/feedback.ts`
- Validation artifacts:
  - `docs/reports/2026-02-18-agent-feedback-24h-structured-signals-trial.md`
  - `docs/reports/2026-02-18-agent-feedback-24h-structured-signals-trial.json`

## Symptoms
- Popup required cross-checking docs/CLI to decide whether to run, fallback, or remediate first.
- Recovery actions (`auto-recover`, `force-new-session`, `open-tab-if-missing`) were available but not surfaced as one deterministic lane.
- Feedback output had issue counts but no stable `signals`/`backlogSlice` contract for shared plugin+skill prioritization.

## What Didn't Work

**Attempted behavior 1:** Keep readiness logic implicit across existing surfaces.
- **Why it failed:** operators still had to merge multiple outputs mentally before acting.

**Attempted behavior 2:** Provide next actions ad hoc from starter output only.
- **Why it failed:** popup and runtime `/health` still lacked the same contract, so handoffs stayed inconsistent.

**Attempted behavior 3:** Use issue aggregates alone for backlog prioritization.
- **Why it failed:** without confidence/priority/evidence refs, triage stayed manual and less reproducible.

## Solution
Applied a single collaboration-loop contract in four coordinated updates.

### 1) Add canonical `runReadiness` to `/health`
`src/agent/runtime.ts` now computes one verdict with `status`, `modeHint`, `reasons`, `summary`, and optional `nextAction`.

```ts
export function buildRunReadiness(input: RunReadinessInput): HealthResponse["runReadiness"] {
  if (input.appUrlDrift.status === "mismatch") {
    return {
      status: "blocked",
      modeHint: "core",
      reasons: ["app-url-drift:mismatch"],
      summary: "Configured app URL differs from active session URL.",
      nextAction: {
        label: "Align app URL",
        hint: "Apply recommended app-url remediation and re-run readiness checks.",
        command: input.appUrlDrift.recommendedCommand,
      },
    };
  }

  if (!input.cdpReadiness.ok) {
    return {
      status: "fallback",
      modeHint: "terminal-probe",
      reasons: [`cdp-unavailable:${input.cdpReadiness.reason ?? "unknown"}`],
      summary: "CDP is unavailable; use terminal-probe workflow until CDP recovers.",
      nextAction: {
        label: "Run terminal-probe starter",
        hint: "Continue with guarded starter in terminal-probe path.",
        command: buildTerminalProbeStarterCommand(input.appUrl),
      },
    };
  }

  return {
    status: "runnable",
    modeHint: "core",
    reasons: [],
    summary: "Session and CDP are healthy; scenario commands can run.",
    nextAction: null,
  };
}
```

### 2) Surface readiness directly in plugin state and popup
The extension background ingests `/health.runReadiness`, and popup renders `Run` + `Next` rows with status coloring.

```js
function runReadinessPatchFromHealth(health) {
  const runReadiness = health?.runReadiness ?? null;
  return {
    runReadinessStatus: runReadiness?.status ?? null,
    runReadinessMode: runReadiness?.modeHint ?? null,
    runReadinessSummary: runReadiness?.summary ?? null,
    runReadinessNextAction: runReadiness?.nextAction?.hint ?? null,
    runReadinessCommand: runReadiness?.nextAction?.command ?? null,
  };
}
```

### 3) Add deterministic starter verdict and recovery lane
`visual_debug_start.py` now emits `readinessVerdict` and `recoveryLane` with precedence:
- config alignment lane: `preview -> apply -> resume`
- session/CDP lane: `soft-recovery -> force-new-session -> open-tab-if-missing`

```py
def build_recovery_lane(...):
    if app_status_normalized in {"mismatch", "not-provided", "invalid-actual-url"} or app_url_reasons:
        return {"class": "config-alignment", "actions": [...], "primaryAction": actions[0]}

    if session_recovery_reasons:
        return {"class": "session-cdp-recovery", "actions": [...], "primaryAction": actions[0]}

    return {"class": "none", "actions": [], "primaryAction": None}
```

### 4) Add structured feedback schema for shared triage
`agent:feedback` JSON now includes stable `schemaVersion`, `signals`, and `backlogSlice`.

```ts
type StructuredSignal = {
  signalId: string;
  issueId: string;
  area: "plugin" | "skill" | "shared";
  signalType: "explicit" | "inferred";
  confidence: "high" | "medium" | "low";
  priorityHint: "p0" | "p1" | "p2";
  evidenceRefs: Array<{ sessionId: string | null; timestamp: string | null; workspace: string | null; filePath: string }>;
};
```

## Validation
Commands executed during the fix cycle:

```bash
python3 skills/fix-app-bugs/scripts/test_visual_debug_start.py
npm test
npm run skill:sync:check
npm run -s agent:feedback -- --window 24h --targets browser-debug,fix-app-bugs --json
```

Observed outcomes:
- tests passed (`npm test`: 12 files / 61 tests in the verification run)
- structured trial artifact generated with `schemaVersion=2026-02-18-feedback-signals-v1`
- trial command metrics: `durationMs=368`, `retryCount=0`
- rollout notes include routing trace fields: `triggerMatched=false`, `ruleId=R5-NO-ROUTE`, `modeSelected=core`, `fallbackUsed=false`, `killSwitchState=enabled`

## Why This Works
- One canonical readiness contract removes ambiguity between runtime, plugin UI, and starter outputs.
- Recovery precedence is explicit and ordered, reducing random retry patterns.
- Structured signals convert retrospective data into deterministic backlog inputs with confidence and evidence refs.
- Regression tests now lock both behavior and precedence (mismatch/session-state before CDP fallback).

## Prevention
- Keep new machine-readable contract fields additive and test-gated (`runReadiness`, `readinessVerdict`, `recoveryLane`, `signals`).
- Whenever readiness semantics change, update docs triad together: `README.md`, `README-debug.md`, `AGENTS.md`.
- Record routing trace fields in rollout artifacts for every collaboration-loop change.
- Treat feedback cadence as manual-by-default until multi-day signal quality is stable.

## Related Documentation
- `docs/solutions/logic-errors/feedback-scope-and-safe-appurl-remediation-20260217.md`
- `docs/solutions/logic-errors/bootstrap-diagnostics-false-failures-fix-app-bugs-20260212.md`
- `docs/plans/2026-02-18-feat-plugin-skill-collaboration-readiness-loop-plan.md`
- `docs/reports/2026-02-18-agent-feedback-24h-structured-signals-trial.md`

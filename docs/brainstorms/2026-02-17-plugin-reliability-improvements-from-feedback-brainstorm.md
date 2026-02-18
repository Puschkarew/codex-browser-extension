---
date: 2026-02-17
topic: plugin-reliability-improvements-from-feedback
---

# Plugin Reliability Improvements from Feedback

## What We're Building
We are defining a focused reliability upgrade for the Browser Debug plugin workflow based on the feedback dated 2026-02-17. The goal is to make terminal-probe and visual-parity runs more deterministic by reducing manual session orchestration, minimizing CDP/session flakiness impact, and improving failure diagnostics quality.

Scope is workflow reliability and operator experience, not app-specific bug logic. The intended outcome is that an agent can run capture flows repeatedly without manual stop/start rituals, with clearer recovery actions when failures occur.

## Why This Approach
We considered three approaches.

### Approach A: Session Lifecycle Autopilot (Recommended)
Add explicit lifecycle controls around `/session/ensure`: `--force-new-session` (stop active session + ensure new), plus optional lightweight retry/backoff when CDP is transiently unavailable.

**Pros:**
- Directly addresses stale session, `409 SESSION_ALREADY_RUNNING`, and cross-run instability.
- Reduces manual pre-steps and makes repeated runs predictable.

**Cons:**
- Adds some behavior complexity to session resolution logic.
- Needs careful defaults to avoid surprising users.

**Best when:** repeated visual/parity runs fail due to stale or conflicting session state.

### Approach B: Target/Tab Resilience Layer
Add `--open-tab-if-missing` and target-recovery helpers so pipeline can recover from missing tab or failing `navigate` without manual CDP `/json/new` steps.

**Pros:**
- Removes brittle manual tab bootstrap steps.
- Improves success rate for automated scenario execution.

**Cons:**
- More browser-side side effects (new tabs) to control.
- Requires strict guardrails to avoid opening wrong targets.

**Best when:** most failures are target-not-found or navigation-related.

### Approach C: Deep Diagnostic Payloads
Expand `runtime.json` command failure records to keep structured response details (status, error code, message, sanitized body) instead of generic error text.

**Pros:**
- Faster root-cause analysis for `422`/`503` failures.
- Better evidence quality for handoff and retrospectives.

**Cons:**
- Does not itself reduce failure frequency.
- Requires redaction discipline for safety.

**Best when:** teams already have workarounds but lose time understanding failure causes.

Recommendation: start with Approach A, then add the smallest high-value subset of Approach C. This follows YAGNI by solving the highest-friction reliability issue first while improving evidence quality without building a heavy orchestrator.

## Key Decisions
- Prioritize session reliability before broader workflow automation.
- Add first-class “new session” behavior instead of relying on manual `/session/stop`.
- Keep tab recovery explicit and opt-in (`--open-tab-if-missing`) rather than default-on.
- Preserve backward compatibility for existing commands and docs.
- Treat structured error detail in artifacts as part of the evidence contract.

## Open Questions
- Should `--force-new-session` be default for `--session-id auto`, or opt-in only?
- Should `--open-tab-if-missing` open one tab per run, or retry existing targets first?
- What retry policy is acceptable for transient `CDP_UNAVAILABLE` (count/backoff)?
- Which error fields must always be persisted in `runtime.json` vs only in verbose mode?
- Should lifecycle diagnostics be exposed only in artifacts or also in `/health`/CLI output summaries?

## Next Steps
→ `/prompts:workflows-plan` to convert the selected approach into implementation tasks and acceptance criteria.

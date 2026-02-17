# Every Auto Routing Contract

Last updated: 2026-02-12

## Scope
This contract defines when Every workflow/reviewer/debug skills auto-route into Browser Debug + `fix-app-bugs` and how fallback behavior is enforced.

## Canonical Registry Model
- Source of truth: `$CODEX_HOME/skills/workflows-shared/references/auto-routing-contract.md`
- Repo mirror: `docs/contracts/auto-routing-contract.md`
- `CODEX_HOME` resolution rule: `CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"`

## Global and Session Controls
- Global kill-switch: `EVERY_AUTO_ROUTING_ENABLED` (`true` by default).
- If `EVERY_AUTO_ROUTING_ENABLED=false`, all auto-routing MUST resolve to `no-route`.
- Session opt-out keywords: `no-auto-routing`, `manual-only`, `skip-browser-debug`.

## Trigger Taxonomy
- `runtime-bug`: incorrect runtime behavior in app flow.
- `visual-regression`: layout/render parity issue.
- `repro-required`: user asks for deterministic evidence.
- `review-needs-runtime`: review explicitly needs runtime proof.
- `non-runtime`: docs/content/refactor-only tasks.

## Routing Decision Precedence
1. Kill-switch check (`EVERY_AUTO_ROUTING_ENABLED`).
2. Session opt-out check.
3. Explicit user request for Browser Debug / `fix-app-bugs` (force route).
4. Skill trigger profile match (auto route).
5. Default `no-route`.

## Mode and Fallback Semantics
When routed:
1. Preserve `Core` as default path.
2. Select `Enhanced` only for strict reproducibility/evidence workflows.
3. Run guarded bootstrap before browser instrumentation.
4. If `browserInstrumentation.canInstrumentFromBrowser=false` OR `bootstrap.status=fallback`, switch to `terminal-probe`.
5. In `terminal-probe`, prohibit page-side `fetch(debugEndpoint)` calls.

## Routing Outcome Status
- `success`: routed and capability gate passed.
- `partial`: routed but in fallback (`terminal-probe`).
- `blocked`: route requested but execution cannot continue (missing prerequisites).

## Required Decision Trace Fields
- `triggerMatched` (bool)
- `triggerClass` (enum)
- `ruleId` (string)
- `autoInvoked` (bool)
- `modeSelected` (`core|enhanced|terminal-probe`)
- `fallbackUsed` (bool)
- `killSwitchState` (`enabled|disabled`)

## KPI Guardrail
Only evaluate rollout KPIs when both are true:
- at least 40 classified runs (`>=20` expected-route, `>=20` expected-no-route)
- sample window spans at least 14 calendar days

# Auto Routing Rollout Decision Record

Date: 2026-02-12

## Scope
Validate routing-contract behavior for workflow/reviewer integration of Browser Debug + `fix-app-bugs` and decide rollout status.

## Dry-Run Execution

Command used:
```bash
npx tsx -e '<matrix script using decideAutoRouting(...)>'
```

Scenario set size: 12

### Scenario Outcomes

| Scenario | Skill | Trigger | Expected Route | Actual Route | Rule | Mode | Fallback | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| S1 | workflows-plan | runtime-bug | true | true | R4-TRIGGER-MATCH | enhanced | false | success |
| S2 | workflows-plan | non-runtime | false | false | R5-NO-ROUTE | - | false | - |
| S3 | workflows-work | runtime-bug | true | true | R4-TRIGGER-MATCH | enhanced | false | success |
| S4 | workflows-review | non-runtime | false | false | R5-NO-ROUTE | - | false | - |
| S5 | workflows-review | review-needs-runtime | true | true | R4-TRIGGER-MATCH | core | false | success |
| S6 | workflows-work | runtime-bug | true | true | R4-TRIGGER-MATCH | terminal-probe | true | partial |
| S7 | workflows-work | runtime-bug + bootstrap fallback | true | true | R4-TRIGGER-MATCH | terminal-probe | true | partial |
| S8 | workflows-work | runtime-bug + kill-switch disabled | false | false | R1-KILL-SWITCH | - | false | - |
| S9 | security-sentinel | non-runtime | false | false | R5-NO-ROUTE | - | false | - |
| S10 | security-sentinel | review-needs-runtime | true | true | R4-TRIGGER-MATCH | core | false | success |
| S11 | performance-oracle | review-needs-runtime + manual-only | false | false | R2-SESSION-OPTOUT | - | false | - |
| S12 | playwright | visual-regression | true | true | R4-TRIGGER-MATCH | core | false | success |

## Precision/Recall Sampling

- False positives: 0
- False negatives: 0
- Contract-level sample size: 12

## Decision

- **Phase 1 integration status:** GO (contract, workflow hooks, phase-2 trigger profiles, fallback semantics, and sync checks are implemented and validated locally).
- **Phase 2 expansion status:** GO for skill-document integration already completed.
- **KPI-governed production confidence gate:** NO-GO yet.

Reason for KPI gate NO-GO:
- Minimum KPI sample protocol is not satisfied (`>=40` classified runs over `>=14` calendar days).

## CI Gate Status

- Routing regression tests are part of `npm test` (`tests/auto-routing.test.ts`, `tests/routing-contract-sync.test.ts`).
- Latest local run: PASS.

## Next Required Steps

1. Collect at least 40 classified real runs over 14+ days.
2. Capture adoption/quality/coverage KPI baseline and post-change values.
3. Re-evaluate go/no-go with live evidence (including mismatch-only vs endpoint-unavailable fallback diagnostics).

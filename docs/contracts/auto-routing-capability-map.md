# Every Auto Routing Capability Map

Last updated: 2026-02-12

## Routing-Relevant Capability Map

| Capability | Trigger class | Primary owner skill | Route target | Notes |
| --- | --- | --- | --- | --- |
| Brainstorm identifies runtime bug context | runtime-bug / repro-required | workflows-brainstorm | Browser Debug + fix-app-bugs | Route only when bug context is explicit, not for pure ideation |
| Plan requires reproducible runtime validation | runtime-bug / repro-required | workflows-plan | Browser Debug + fix-app-bugs | Add routing notes to plan acceptance criteria |
| Work execution on runtime-focused plan | runtime-bug / visual-regression | workflows-work | Browser Debug + fix-app-bugs | Run capability gate before implementation loop |
| Review requires runtime verification evidence | review-needs-runtime | workflows-review | Browser Debug + fix-app-bugs | Do not route for docs-only or static-only review |
| Reproduce reported bug deterministically | runtime-bug / repro-required | bug-reproduction-validator | Browser Debug + fix-app-bugs | Prefer strict evidence path |
| Run browser flow tests with reproducibility needs | visual-regression / repro-required | test-browser | Browser Debug + fix-app-bugs | Keep `agent-browser` flow as base path |
| Automate browser probes/debugging | runtime-bug / visual-regression | playwright | Browser Debug + fix-app-bugs | Route only when debugging evidence is needed |
| Security audit requiring runtime proof | review-needs-runtime | security-sentinel | Browser Debug + fix-app-bugs | Conditional route only |
| Performance audit requiring runtime traces | review-needs-runtime | performance-oracle | Browser Debug + fix-app-bugs | Conditional route only |

## Conflict Resolution
1. Explicit user request wins over heuristic matching.
2. If multiple skills could claim routing, the active command skill owns the decision.
3. Reviewer skills (`security-sentinel`, `performance-oracle`) can request routing only when runtime evidence is explicitly needed.
4. If conflict remains unresolved, default to `no-route` and ask user to confirm strict evidence mode.

## Completion Signaling
- `success`: route + expected mode selected without blockers.
- `partial`: route accepted but fallback mode used.
- `blocked`: prerequisites missing; user action required.

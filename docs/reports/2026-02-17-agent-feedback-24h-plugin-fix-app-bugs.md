---
date: 2026-02-17
window_start_utc: 2026-02-16T12:12:47Z
window_end_utc: 2026-02-17T12:12:47Z
topic: agent-feedback-plugin-fix-app-bugs-24h
source_plan: /Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/docs/plans/2026-02-17-feat-agent-feedback-backlog-roadmap-plan.md
---

# 24h Agent Feedback Audit: Browser Debug Plugin + fix-app-bugs

## Scope
- Analyze last 24 hours of local Codex sessions across projects.
- Extract agent feedback signals related to Browser Debug plugin and `fix-app-bugs`.
- Produce prioritized backlog (`P0/P1/P2`) and a 2-4 week roadmap.

## Routing Trace
- `triggerMatched`: false
- `triggerClass`: non-runtime
- `ruleId`: R5-default-no-route
- `autoInvoked`: false
- `modeSelected`: core
- `fallbackUsed`: false
- `killSwitchState`: enabled

## Coverage
- Session files scanned: `6`
- Workspaces represented: `3`
- Relevant sessions with plugin/skill execution feedback: `2`
- Relevant session IDs:
  - `019c6b42-e7c1-7622-ab7b-37e0a5506acc`
  - `019c6b54-ce4b-7fe2-af48-a3ff7718613d`
- Coverage limitation: direct runtime feedback was concentrated in one workspace (`Select Icons`) during this 24h window.

## Taxonomy and Scoring
- Taxonomy labels:
  - `setup-config`
  - `instrumentation-gate`
  - `fallback-flow`
  - `cleanup-friction`
  - `observability-analytics`
- Scoring dimensions:
  - `frequency`
  - `impact`
  - `workaround_cost`
  - `confidence` (`high|medium|low`, `explicit|inferred`)

## Evidence Highlights
1. `appUrl` mismatch causes capability fallback:
   - `/Users/vladimirpuskarev/.codex/sessions/2026/02/17/rollout-2026-02-17T14-01-12-019c6b42-e7c1-7622-ab7b-37e0a5506acc.jsonl` (`2026-02-17T11:05:17.246Z`)
   - Snippet: `canInstrumentFromBrowser=false`, `terminal-probe`, config `appUrl=localhost:3000` vs actual `localhost:4173`.
2. Same mismatch pattern repeats in another session:
   - `/Users/vladimirpuskarev/.codex/sessions/2026/02/17/rollout-2026-02-17T14-20-45-019c6b54-ce4b-7fe2-af48-a3ff7718613d.jsonl` (`2026-02-17T11:33:25.184Z`)
   - Snippet: bootstrap returned `terminal-probe` due config URL mismatch.
3. Plan-mode blocks direct auto-fix during diagnostics:
   - `/Users/vladimirpuskarev/.codex/sessions/2026/02/17/rollout-2026-02-17T14-01-12-019c6b42-e7c1-7622-ab7b-37e0a5506acc.jsonl` (`2026-02-17T11:05:17.246Z`)
   - Snippet: agent explicitly avoids applying config auto-fix in plan-mode.
4. Cleanup overhead appears in iterative loop:
   - `/Users/vladimirpuskarev/.codex/sessions/2026/02/17/rollout-2026-02-17T14-01-12-019c6b42-e7c1-7622-ab7b-37e0a5506acc.jsonl` (`2026-02-17T11:17:52.509Z`)
   - Snippet: `cleanup_guarded --strict` run before final report.
5. Analytics capability gap is explicitly requested:
   - `/Users/vladimirpuskarev/.codex/sessions/2026/02/17/rollout-2026-02-17T14-12-45-019c6b4d-78ca-7120-ad80-e43930c51e23.jsonl` (`2026-02-17T11:13:14.255Z`, `2026-02-17T11:13:57.861Z`)
   - Snippet: request for cross-project 24h chat analytics.

## Prioritized Backlog

### P0
1. `SH-001` - Reduce `appUrl` mismatch fallback loops
- Area: `shared` (plugin + `fix-app-bugs`)
- Problem: repeated fallback to `terminal-probe` when configured `appUrl` drifts from actual local URL.
- Evidence: sessions `019c6b42...` and `019c6b54...` (high-confidence explicit).
- Proposed change:
  - Add one-step remediation command in bootstrap output (copy-ready).
  - Add mismatch reason code + recommended fix in a concise machine-readable block.
  - Keep apply mode explicit-flag only.
- Expected effect: fewer instrumentation fallbacks; faster move to headed/browser validation.
- Owner: `shared`
- Confidence: `high (explicit)`

### P1
1. `SK-001` - Plan-mode safe config alignment flow
- Area: `fix-app-bugs`
- Problem: plan-mode runs surface mismatch but avoid remediation, causing manual context switching.
- Evidence: session `019c6b42...` (`plan-mode` no auto-fix statement).
- Proposed change:
  - Add `preview-config-fix` output (dry-run patch + command set).
  - Add explicit handoff step to resume bootstrap after manual apply.
- Expected effect: lower friction in planning-to-execution transitions.
- Owner: `skill`
- Confidence: `medium-high (explicit)`

2. `PL-001` - Surface config/app URL drift earlier in plugin health path
- Area: `Browser Debug plugin`
- Problem: mismatch is discovered late during guarded bootstrap, not early in operational health.
- Evidence: mismatch only became visible when running fix workflow in relevant sessions.
- Proposed change:
  - Expose `configAppUrl` vs `actualAppUrl` drift hint in health/readiness output.
  - Link drift to recommended command(s) for correction.
- Expected effect: earlier detection, fewer failed strict runs.
- Owner: `plugin`
- Confidence: `medium (inferred from repeated pattern)`

3. `SH-002` - Add first-class cross-project feedback audit command
- Area: `shared`
- Problem: no native command to aggregate plugin/skill feedback over recent sessions; current process required ad-hoc parsing.
- Evidence: explicit user request in session `019c6b4d...`.
- Proposed change:
  - Add command (example): `npm run agent:feedback -- --window 24h --targets browser-debug,fix-app-bugs`.
  - Emit backlog-ready JSON + markdown summary.
- Expected effect: predictable, repeatable daily feedback loop.
- Owner: `shared`
- Confidence: `high (explicit requirement)`

### P2
1. `SK-002` - Reduce strict cleanup cost during iterative loops
- Area: `fix-app-bugs`
- Problem: strict cleanup is valuable for closure but expensive in iterative tuning loops.
- Evidence: strict cleanup invocation observed in active bugfix cycle (`019c6b42...`).
- Proposed change:
  - Add lightweight cleanup mode for intermediate iterations.
  - Keep strict cleanup mandatory for final closure only.
- Expected effect: reduced iteration latency without losing final hygiene guarantees.
- Owner: `skill`
- Confidence: `medium (inferred)`

2. `SH-003` - Emit structured feedback events for analytics
- Area: `shared`
- Problem: unstructured natural-language session logs increase noise and reduce precision of automated analysis.
- Evidence: broad instruction content dominated raw search results; relevant signals required custom filtering.
- Proposed change:
  - Emit structured end-of-run feedback fields (`issueCategory`, `fallbackReason`, `appUrlStatus`, `cleanupMode`, `outcome`).
- Expected effect: higher precision and lower effort for trend tracking.
- Owner: `shared`
- Confidence: `medium (inferred)`

## 2-4 Week Roadmap

## Week 1 (Commit)
1. Deliver `SH-001`:
- Exit criterion: mismatch fallback guidance appears in one concise block with actionable remediation command.
2. Deliver `SK-001`:
- Exit criterion: plan-mode run includes explicit preview + resume path for config alignment.

## Week 2 (Commit)
1. Deliver `PL-001`:
- Exit criterion: health/readiness view shows drift hint before strict bootstrap phase.
2. Deliver `SH-002`:
- Exit criterion: one command generates 24h feedback summary with per-issue evidence references.

## Week 3-4 (Optional)
1. Deliver `SK-002`:
- Exit criterion: intermediate cleanup mode available and documented; strict still required for final closure.
2. Deliver `SH-003`:
- Exit criterion: structured feedback events available and consumable for aggregate reporting.

## Risks and Guardrails
- Risk: overfitting to one-day sample.
  - Guardrail: require second-day confirmation before escalating inferred `P2` items to `P1`.
- Risk: expanding scope beyond plugin/skill feedback.
  - Guardrail: keep backlog intake strictly within defined taxonomy.
- Risk: ambiguity in shared ownership items.
  - Guardrail: assign a single decision driver per shared item at kickoff.

## Validation Checklist (Completed for This Run)
- [x] 24h file boundary applied.
- [x] Session coverage and limitations documented.
- [x] Findings tagged with taxonomy and confidence.
- [x] Backlog includes `P0/P1/P2`, evidence, owner, expected effect.
- [x] 2-4 week roadmap attached with exit criteria.

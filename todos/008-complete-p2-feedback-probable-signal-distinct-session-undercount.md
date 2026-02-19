---
status: complete
priority: p2
issue_id: "008"
tags: [code-review, analytics, feedback, reliability]
dependencies: []
---

# Fix distinct-session counting for probable signal promotion

Probable signal promotion currently relies on `evidenceRefs`, which are sourced from `samples`.  
Because samples are capped at 3 entries, repeated hits from one session can hide additional sessions and incorrectly defer promotion.

## Problem Statement

Backlog promotion should reflect distinct session recurrence. Current logic can undercount distinct sessions, causing valid recurring inferred signals to remain deferred.

## Findings

- `pushIssueSample` hard-caps samples at 3 in `src/cli/feedback.ts:264`.
- Promotion distinct-session counting uses only `evidenceRefs` in `src/cli/feedback.ts:295`.
- Promotion gating uses that undercount in `src/cli/feedback.ts:307`.
- Repro from review:
  - Session A contained 3 matching inferred messages.
  - Session B contained 1 matching inferred message.
  - Output still reported `observedDistinctSessions: 1` and `status: "deferred"` for `cleanup_strict_iteration_cost`.

## Proposed Solutions

### Option 1: Track distinct session/file IDs on aggregate independently of samples

**Approach:** Add a `distinctEvidenceKeys` set-like structure to `IssueAggregate` and use it for promotion math; keep sample cap only for display.

**Pros:**
- Correct recurrence metrics without expanding report payload.
- Preserves concise samples output.

**Cons:**
- Requires small data model extension.

**Effort:** 1-2 hours  
**Risk:** Low

---

### Option 2: Keep sample cap but prioritize unique sessions in sampling

**Approach:** Replace first-come sample append with logic that favors unseen session IDs/file paths.

**Pros:**
- Minimal schema changes.
- Improves evidence diversity.

**Cons:**
- Still approximate and tied to cap.
- Can still miss distinct sessions in high-volume files.

**Effort:** 1-2 hours  
**Risk:** Medium

---

### Option 3: Compute promotion recurrence from per-session counters in a second pass

**Approach:** During scan, record issue presence per session; evaluate promotion using session-level map.

**Pros:**
- Most robust and explicit recurrence model.
- Decouples reporting samples from decision logic.

**Cons:**
- Larger refactor than needed right now.

**Effort:** 2-4 hours  
**Risk:** Medium

## Recommended Action

Option 1 implemented: distinct evidence keys are tracked independently from capped samples and used for promotion decisions.

## Technical Details

**Affected files:**
- `src/cli/feedback.ts:264`
- `src/cli/feedback.ts:295`
- `src/cli/feedback.ts:307`
- `tests/feedback.test.ts` (add regression for skewed sample distribution across sessions)

**Related components:**
- Feedback report schema (`signals[].promotion` and `backlogSlice`).

**Database changes (if any):**
- Migration needed? No

## Resources

- **Review target:** `8a3ec8c..b482957`
- **Repro command:** ad-hoc `CODEX_HOME=<tmp> tsx src/cli/feedback.ts --window 24h --targets fix-app-bugs --json` with crafted session files.

## Acceptance Criteria

- [x] Probable inferred signal with matches across 2+ distinct sessions is promoted even when one session contributes first 3 samples.
- [x] `observedDistinctSessions` reflects true distinct evidence recurrence, not sample-cap artifacts.
- [x] Existing tests pass.
- [x] New regression test covers the "3 hits in session A + 1 hit in session B" case.

## Work Log

### 2026-02-19 - Code review finding capture

**By:** Codex

**Actions:**
- Audited signal promotion flow in `src/cli/feedback.ts`.
- Built a two-session reproduction where current output undercounted distinct sessions.
- Documented options to decouple promotion counting from sample truncation.

**Learnings:**
- Display-oriented sample caps should not drive decision logic.

### 2026-02-19 - Implementation complete

**By:** Codex

**Actions:**
- Updated `src/cli/feedback.ts` to accumulate per-issue distinct evidence keys during scanning and use them for promotion.
- Added regression in `tests/feedback.test.ts` that reproduces sample-cap skew (`3x session-a + 1x session-b`).
- Validated with `npm test -- tests/cdp-controller.test.ts tests/feedback.test.ts`.

**Learnings:**
- Promotion metrics must be derived from full recurrence state, while samples remain a presentation concern.

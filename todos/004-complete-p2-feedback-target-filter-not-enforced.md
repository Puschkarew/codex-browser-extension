---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, quality, analytics]
dependencies: []
---

# Enforce `--targets` filter in feedback issue aggregation

`agent:feedback` accepts `--targets`, but issue aggregation currently ignores that filter and still reports issues from unrelated messages.

## Problem Statement

The CLI advertises target-scoped analytics (`--targets browser-debug,fix-app-bugs`), but counts issue patterns from all parsed messages regardless of target match. This makes reports misleading and breaks trust in scoped analysis.

## Findings

- In `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/feedback.ts:288`, `relevantHits` uses `targetPattern`.
- In `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/feedback.ts:292`, issue patterns are still evaluated for every message, even when `targetPattern` does not match.
- Reproduction: `npm run agent:feedback -- --window 24h --targets nonexistent-target --json` still returns non-zero `relevantSessions` and populated `issues`.

## Proposed Solutions

### Option 1: Gate issue matching by target match (recommended)

**Approach:** Skip issue pattern evaluation unless message passed `targetPattern` (or add explicit override flag).

**Pros:**
- Behavior matches CLI contract.
- Minimal implementation and easy to test.

**Cons:**
- May hide cross-cutting issues if user passes narrow targets.

**Effort:** Small

**Risk:** Low

---

### Option 2: Keep global issue scan, but split scoped/global outputs

**Approach:** Maintain global issue counts separately and expose two sections (`scopedIssues`, `globalIssues`).

**Pros:**
- Maximum observability.
- Preserves current behavior while clarifying semantics.

**Cons:**
- Larger output/API change.
- More docs/test updates.

**Effort:** Medium

**Risk:** Medium

## Recommended Action


## Technical Details

**Affected files:**
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/feedback.ts`

**Database changes:**
- No

## Resources

- Command repro: `npm run agent:feedback -- --window 24h --targets nonexistent-target --json`

## Acceptance Criteria

- [ ] Issue aggregation respects `--targets` scope.
- [ ] A target with zero matches yields `relevantSessions=0` and empty `issues` (unless explicitly configured otherwise).
- [ ] Regression test covers scoped vs unscoped behavior.

## Work Log

### 2026-02-17 - Initial Discovery

**By:** Codex

**Actions:**
- Reviewed `agent:feedback` implementation and output behavior.
- Reproduced mismatch between CLI intent and output using a non-matching target.

**Learnings:**
- Current implementation applies `targetPattern` only to `relevantHits`, not issue aggregation.

## Notes

- This is a correctness issue in analytics output, not a runtime stability issue.

### 2026-02-17 - Fix Implemented

**By:** Codex

**Actions:**
- Updated `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/cli/feedback.ts` to evaluate issue patterns only when message matches `--targets` scope.
- Added regression integration test in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/tests/feedback.test.ts` using temporary `CODEX_HOME` sessions.
- Validated with `npm test` and direct CLI run using `--targets nonexistent-target`.

**Learnings:**
- Filtering logic must gate both session relevance and issue extraction to keep analytics contract consistent.

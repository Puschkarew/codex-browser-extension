---
status: complete
priority: p2
issue_id: "007"
tags: [code-review, reliability, runtime, cdp]
dependencies: []
---

# Drain loadEvent promise on early navigate/reload failures

`src/agent/cdp-controller.ts` starts `Page.loadEventFired()` before `Page.navigate()` / `Page.reload()`.  
When navigate/reload fails early, the pre-created `loadEvent` promise can reject later without a consumer, producing `unhandledRejection` noise and unstable error handling paths.

## Problem Statement

Navigation/reload error paths should not create unhandled asynchronous rejections. The current flow can leak a rejection from `loadEventFired` when the main command fails before `waitForNavigationCompletion` consumes that promise.

## Findings

- In `src/agent/cdp-controller.ts:130` and `src/agent/cdp-controller.ts:143`, `loadEvent` is created before calling reload/navigate.
- In `src/agent/cdp-controller.ts:135` and `src/agent/cdp-controller.ts:148`, catch blocks rethrow without draining `loadEvent`.
- Repro script observed `{"unhandled":"Error: load-event failure"}` while `navigate` also failed, confirming unhandled rejection behavior.

## Proposed Solutions

### Option 1: Drain `loadEvent` in catch before rethrow

**Approach:** If `loadEvent` exists and reload/navigate throws, call `void loadEvent.catch(() => undefined)` before rethrowing.

**Pros:**
- Minimal, targeted patch.
- Matches previous behavior pattern.

**Cons:**
- Requires keeping subtle lifecycle logic in two call sites.

**Effort:** 30-60 minutes  
**Risk:** Low

---

### Option 2: Create load-event waiter only after command succeeds

**Approach:** Move `prepareLoadEventPromise` invocation after `Page.navigate` / `Page.reload`.

**Pros:**
- Eliminates pre-created promise leak path.
- Cleaner control flow.

**Cons:**
- Could miss a very fast load event in some CDP implementations if listener timing matters.

**Effort:** 1-2 hours  
**Risk:** Medium

---

### Option 3: Wrap load-event promise in a settled guard utility

**Approach:** Introduce helper returning `{ promise, suppressUnhandled() }` and guarantee suppression in all exits.

**Pros:**
- Centralized and explicit async lifecycle handling.
- Reusable for other event waiters.

**Cons:**
- More code than needed for current scope.

**Effort:** 2-3 hours  
**Risk:** Medium

## Recommended Action

Option 1 implemented: drain `loadEvent` rejections in early-failure navigate/reload catch paths.

## Technical Details

**Affected files:**
- `src/agent/cdp-controller.ts:130`
- `src/agent/cdp-controller.ts:143`
- `src/agent/cdp-controller.ts:522`

**Related components:**
- Agent runtime process-level rejection logging (`src/agent/index.ts`).

**Database changes (if any):**
- Migration needed? No

## Resources

- **Review target:** `8a3ec8c..b482957`
- **Repro artifact:** ad-hoc `tsx` script run during review confirming unhandled rejection in navigate failure path.

## Acceptance Criteria

- [x] No unhandled promise rejection when `navigate` fails and `loadEventFired` rejects asynchronously.
- [x] No unhandled promise rejection when `reload` fails and `loadEventFired` rejects asynchronously.
- [x] Existing `tests/cdp-controller.test.ts` passes.
- [x] New regression test covers the early-failure + load-event rejection path.

## Work Log

### 2026-02-19 - Code review finding capture

**By:** Codex

**Actions:**
- Reviewed navigation fallback refactor in `src/agent/cdp-controller.ts`.
- Reproduced failure mode with a controlled fake client showing unhandled rejection.
- Documented remediation options and acceptance criteria.

**Learnings:**
- Promise lifecycle around pre-armed CDP event waiters is fragile in early-failure paths.

### 2026-02-19 - Implementation complete

**By:** Codex

**Actions:**
- Updated `src/agent/cdp-controller.ts` to suppress pending `loadEvent` rejections on early navigate/reload failures.
- Added regression test in `tests/cdp-controller.test.ts` covering async load-event rejection during navigate failure.
- Validated with `npm test -- tests/cdp-controller.test.ts tests/feedback.test.ts`.

**Learnings:**
- Local suppression of pre-armed event promises keeps failure paths deterministic without altering success semantics.

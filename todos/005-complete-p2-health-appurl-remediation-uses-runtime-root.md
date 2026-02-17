---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, architecture, reliability]
dependencies: []
---

# `/health.appUrlDrift.recommendedCommand` may point to wrong project root

The new remediation command in `/health.appUrlDrift` builds `--project-root` from runtime root directory, which is the agent process cwd, not guaranteed to be the app project that actually needs config alignment.

## Problem Statement

If users copy/paste `recommendedCommand` from `/health`, bootstrap may run against the wrong directory and mutate/create `.codex/browser-debug.json` in an unintended repo. This can cause configuration drift and operator confusion.

## Findings

- Runtime root is initialized from `process.cwd()` in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/index.ts:14`.
- `buildAppUrlDrift` receives `projectRoot` from `this.rootDir` in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:552`.
- `recommendedCommand` embeds that root directly in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:216` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts:233`.

## Proposed Solutions

### Option 1: Emit command without `--project-root` and require explicit root (recommended)

**Approach:** Provide a safe template command with `<project-root>` placeholder instead of auto-filled runtime root.

**Pros:**
- Avoids accidental writes to wrong repo.
- Makes user intent explicit.

**Cons:**
- Slightly less one-click convenience.

**Effort:** Small

**Risk:** Low

---

### Option 2: Track and use active app project root in runtime state

**Approach:** Extend runtime/session model to store project root supplied by setup flow and use it for remediation command generation.

**Pros:**
- Accurate copy-ready command.
- Better UX for multi-project usage.

**Cons:**
- Requires plumbing project identity through runtime APIs.

**Effort:** Medium

**Risk:** Medium

## Recommended Action


## Technical Details

**Affected files:**
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/index.ts`
- `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts`

**Database changes:**
- No

## Resources

- `/health` response field: `appUrlDrift.recommendedCommand`

## Acceptance Criteria

- [ ] Remediation command cannot target unintended repo by default.
- [ ] Documentation explains how project root is determined.
- [ ] Tests assert safe command construction behavior.

## Work Log

### 2026-02-17 - Initial Discovery

**By:** Codex

**Actions:**
- Traced runtime root source and command generation path for `appUrlDrift.recommendedCommand`.
- Validated that command root is derived from process cwd, not explicit app project root.

**Learnings:**
- Current implementation is convenient but not reliably context-safe in cross-project usage.

## Notes

- Marked as P2 because it is copy/paste-triggered but can cause misconfiguration.

### 2026-02-17 - Fix Implemented

**By:** Codex

**Actions:**
- Updated `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/src/agent/runtime.ts` so `appUrlDrift.recommendedCommand` uses `--project-root <project-root>` placeholder instead of runtime cwd.
- Added focused unit test `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/tests/app-url-drift.test.ts` to assert safe command format.
- Updated docs in `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README.md` and `/Users/vladimirpuskarev/Library/Mobile Documents/com~apple~CloudDocs/Codex/Browser Extension/README-debug.md` to explain placeholder replacement.

**Learnings:**
- Health remediation hints should prioritize context safety over copy-paste convenience in multi-project workflows.

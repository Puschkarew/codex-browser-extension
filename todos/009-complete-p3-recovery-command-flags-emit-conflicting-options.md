---
status: complete
priority: p3
issue_id: "009"
tags: [code-review, ux, reliability, tooling]
dependencies: []
---

# Remove mutually conflicting flags from recovery command suggestions

Generated recovery commands can contain contradictory CLI flags in one command string, which is confusing and weakens operator trust in suggested next actions.

## Problem Statement

Helper output should emit canonical, non-conflicting commands. Today some generated suggestions include both positive and negative variants of the same flag.

## Findings

- `build_resume_variant_command` only appends flags and does not remove opposite variants (`skills/fix-app-bugs/scripts/visual_debug_start.py:285`).
- With `--no-open-tab-if-missing` input, `open-tab-recovery` action can emit both `--no-open-tab-if-missing` and `--open-tab-if-missing` in one command (`skills/fix-app-bugs/scripts/visual_debug_start.py:989`).
- `PIPELINE_RETRY_EXACT_COMMAND` includes both `--tab-url-match-strategy origin-path` and `--tab-url-match-strategy exact` (`skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:34`).

## Proposed Solutions

### Option 1: Canonicalize flags with a mutual-exclusion map (recommended)

**Approach:** Before rendering command strings, drop opposite flags (for example `--no-open-tab-if-missing` when `--open-tab-if-missing` is present) and keep only the final intended variant.

**Pros:**
- Clear and deterministic command output.
- Small implementation footprint.

**Cons:**
- Requires maintaining a tiny conflict map.

**Effort:** 1 hour  
**Risk:** Low

---

### Option 2: Build structured command objects, render once

**Approach:** Store command intent as structured fields then render CLI args in a single pass.

**Pros:**
- Prevents duplicate/conflicting args by design.
- Easier to test systematically.

**Cons:**
- More refactor overhead for current need.

**Effort:** 2-4 hours  
**Risk:** Medium

---

### Option 3: Post-process generated strings with regex cleanup

**Approach:** Keep current construction, then normalize known conflicting pairs in final strings.

**Pros:**
- Fastest patch.

**Cons:**
- Fragile and harder to extend.

**Effort:** 30-45 minutes  
**Risk:** Medium

## Recommended Action

Option 1 implemented: canonicalized mutually exclusive flags and normalized exact-match retry command construction.

## Technical Details

**Affected files:**
- `skills/fix-app-bugs/scripts/visual_debug_start.py:285`
- `skills/fix-app-bugs/scripts/visual_debug_start.py:989`
- `skills/fix-app-bugs/scripts/terminal_probe_pipeline.py:34`

**Related components:**
- `nextAction` and `recoveryLane.actions[*].command` guidance payloads.

**Database changes (if any):**
- Migration needed? No

## Resources

- **Review target:** `8a3ec8c..b482957`
- **Observed output sample:** `... --no-open-tab-if-missing ... --open-tab-if-missing`.

## Acceptance Criteria

- [x] Generated recovery commands never include both variants of a boolean flag.
- [x] Generated recovery commands never include duplicate values for single-choice flags (for example match strategy).
- [x] Existing smoke tests pass.
- [x] Add at least one regression assertion for conflicting flag prevention.

## Work Log

### 2026-02-19 - Code review finding capture

**By:** Codex

**Actions:**
- Traced command-generation paths in visual starter and terminal-probe helpers.
- Reproduced conflicting-flag command output with `--no-open-tab-if-missing` input.
- Captured remediation options with low-risk canonicalization path.

**Learnings:**
- Command synthesis helpers need explicit mutual-exclusion handling to avoid contradictory guidance.

### 2026-02-19 - Implementation complete

**By:** Codex

**Actions:**
- Added mutual-exclusion handling in `skills/fix-app-bugs/scripts/visual_debug_start.py` for `--open-tab-if-missing` vs `--no-open-tab-if-missing`.
- Updated `skills/fix-app-bugs/scripts/terminal_probe_pipeline.py` to generate `PIPELINE_RETRY_EXACT_COMMAND` without duplicated strategy flags.
- Added regression assertions in `skills/fix-app-bugs/scripts/test_visual_debug_start.py` and `skills/fix-app-bugs/scripts/test_terminal_probe_pipeline.py`.
- Validated with both smoke suites.

**Learnings:**
- Command suggestion payloads should be assembled with explicit flag conflict rules to preserve operator trust.

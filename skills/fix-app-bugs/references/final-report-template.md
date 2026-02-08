# Final Report Template

Every `fix-app-bugs` run must end with these five blocks.

## 1) Root Cause

- One concrete code-level cause.
- Include exact component/module/function where divergence starts.

## 2) Patch

- Smallest targeted change that addresses the confirmed root cause.
- Mention files changed and why each change is required.

## 3) Validation

- What was re-run: tests/build/typecheck/runtime checks.
- Evidence from reproduction (same user-visible symptom).
- Include `checks.appUrl.configAppUrl` and `checks.appUrl.actualAppUrl`.
- If `bootstrap.status = fallback`, state it explicitly as a hard fact.
- For WebGL/render tasks, include at least one headed browser-visible validation.
- For parity checks, include paths to `runtime.json`, `metrics.json`, and `summary.json` from `compare-reference`.

## 4) Instrumentation Status

- `cleaned` or `not added`.
- Include command and result from guarded cleanup:
  - `bash scripts/cleanup_guarded.sh <project-root>`
  - add `--strict` when used
- If fallback cleanup path was used, state that explicitly.

## 5) Residual Risk

- What remains unverified.
- Why it is not yet verified.
- What exact follow-up check would close the risk.

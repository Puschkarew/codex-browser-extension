# Debug Log Spec

Use this reference when adding temporary instrumentation for bug diagnosis.

## Bootstrap First (Guarded)

Before instrumentation, run guarded bootstrap:

```bash
python3 scripts/bootstrap_guarded.py --project-root <project-root> --json
```

If you have the actual page URL from reproduction flow, include it:

```bash
python3 scripts/bootstrap_guarded.py --project-root <project-root> --actual-app-url <url> --json
```

Read these fields first:
1. `browserInstrumentation.canInstrumentFromBrowser`
2. `browserInstrumentation.mode`
3. `browserInstrumentation.reason`
4. `bootstrap.status`
5. `bootstrap.reason`
6. `debugEndpoint`
7. `queryEndpoint`
8. `checks` (if underlying bootstrap ran successfully)
9. `checks.appUrl.checklist` and `checks.appUrl.recommendedCommands`
10. `checks.tools.playwright.wrapperSmoke` and `checks.tools.playwright.npxSmoke`
11. `checks.appUrl.configAppUrl`, `checks.appUrl.actualAppUrl`, and `checks.appUrl.recommendedActualAppUrl`

For `checks.appUrl.status = not-provided` or `checks.appUrl.status = mismatch`, use `checks.appUrl.recommendedCommands`, re-run bootstrap, and do not proceed until `checks.appUrl.status = match`.
Apply config changes only with explicit `--apply-recommended`.

## Capability Gate

Rules:
1. Browser-side instrumentation is allowed only when `canInstrumentFromBrowser = true`.
2. If `canInstrumentFromBrowser = false`, mode is `terminal-probe`.
3. If `bootstrap.status = fallback`, treat browser instrumentation as unavailable.
4. In `terminal-probe` mode, do not call page-side `fetch(debugEndpoint)`.
5. Always print `configAppUrl` and `actualAppUrl` together in run status updates.

## Event Shape

Emit events as structured objects when possible:

```json
{
  "marker": "BUGFIX_TRACE",
  "tag": "checkout-submit",
  "event": "validation-result",
  "traceId": "9b2a...",
  "ts": "2026-02-06T13:00:00.000Z",
  "data": {
    "isValid": false,
    "missingFields": 2
  }
}
```

## Required Fields

1. `marker`: fixed token `BUGFIX_TRACE`.
2. `tag`: short issue area identifier.
3. `event`: what happened.
4. `ts`: timestamp.
5. `data`: minimum state needed to validate hypotheses.

## Redaction Rules

1. Never log secrets, auth tokens, passwords, or full personal identifiers.
2. Log booleans/counts/enums instead of raw sensitive values.
3. If a value is needed for diagnosis, log a masked form.

## JavaScript/TypeScript Patterns

Use existing app logging transport when available:

```ts
debugServer.send({
  marker: "BUGFIX_TRACE",
  tag: "checkout-submit",
  event: "before-submit",
  ts: new Date().toISOString(),
  data: { cartItems: cart.length, hasAddress: Boolean(address) }
});
```

HTTP fallback (`debugEndpoint` from guarded bootstrap) is allowed only in `browser-fetch` mode:

```ts
await fetch(debugEndpoint, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    marker: "BUGFIX_TRACE",
    tag: "checkout-submit",
    event: "before-submit",
    ts: new Date().toISOString(),
    data: { cartItems: cart.length, hasAddress: Boolean(address) }
  })
});
```

Do not use this fetch path when bootstrap reports `canInstrumentFromBrowser = false`.

Query example (`queryEndpoint` from bootstrap output):

```bash
curl "${queryEndpoint}?from=2026-02-06T12:00:00.000Z&to=2026-02-06T12:30:00.000Z&tag=checkout-submit&traceId=9b2a...&limit=500"
```

Wrap temporary blocks with marker comments for cleanup:

```ts
// BUGFIX_TRACE begin(checkout-submit)
// temporary diagnostic logging
// BUGFIX_TRACE end(checkout-submit)
```

## Terminal-Probe Evidence Path

When mode is `terminal-probe`, use this evidence order:
1. Terminal/server probe events.
2. Deterministic code-path checks.
3. Playwright screenshots or snapshots.
4. Reproduction window correlation from user timestamps.

For WebGL/render symptoms, include at least one headed run. Treat fully black headless screenshots as potential false negatives until confirmed with browser-visible behavior or concrete runtime errors.

## Reference Parity Evidence

When comparing visual parity:
1. Keep both source images from the same scenario.
2. Run `compare-reference`.
3. Attach one artifact folder containing `runtime.json`, `metrics.json`, and `summary.json`.
4. Include these artifact paths in the final report.

## Render Bug Guardrail

For fullscreen/WebGL render issues, validate all four before patch and after patch:
1. Clip-space fullscreen coverage (`gl_Position`).
2. UV range coverage (`vUv` in `[0..1]`).
3. Canvas CSS size vs drawing buffer size.
4. Clear/blend/alpha state for final composite.

Do not treat headless black screenshots as sole proof of regression or fix success.
Headed browser-visible confirmation is required for final render validation.

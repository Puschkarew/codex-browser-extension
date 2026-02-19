import { describe, expect, it } from "vitest";
import { buildAppUrlDrift, buildRunReadiness } from "../src/agent/runtime.js";

describe("buildRunReadiness", () => {
  it("returns blocked state for app-url mismatch with remediation command", () => {
    const appUrlDrift = buildAppUrlDrift("http://localhost:3000", "http://localhost:4173");
    const readiness = buildRunReadiness({
      appUrl: "http://localhost:3000",
      appUrlDrift,
      cdpReadiness: { ok: true, reason: null },
      activeSession: {
        sessionId: "session-1",
        state: "running",
        tabUrl: "http://localhost:4173",
        startedAt: "2026-02-18T00:00:00.000Z",
      },
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.modeHint).toBe("core");
    expect(readiness.reasons).toContain("app-url-drift:mismatch");
    expect(readiness.nextAction?.command).toContain("--project-root <project-root>");
  });

  it("returns fallback state when CDP is unavailable", () => {
    const appUrlDrift = buildAppUrlDrift("http://localhost:3000", null);
    const readiness = buildRunReadiness({
      appUrl: "http://localhost:3000",
      appUrlDrift,
      cdpReadiness: { ok: false, reason: "Connection refused" },
      activeSession: false,
    });

    expect(readiness.status).toBe("fallback");
    expect(readiness.modeHint).toBe("terminal-probe");
    expect(readiness.reasons).toContain("cdp-unavailable:Connection refused");
    expect(readiness.nextAction?.command).toContain("visual_debug_start.py");
  });

  it("returns runnable state when runtime is healthy but session is not started", () => {
    const appUrlDrift = buildAppUrlDrift("http://localhost:3000", null);
    const readiness = buildRunReadiness({
      appUrl: "http://localhost:3000",
      appUrlDrift,
      cdpReadiness: { ok: true, reason: null },
      activeSession: false,
    });

    expect(readiness.status).toBe("runnable");
    expect(readiness.modeHint).toBe("core");
    expect(readiness.reasons).toContain("session:none");
    expect(readiness.nextAction?.command).toContain("npm run agent:session");
  });

  it("prioritizes app-url mismatch over CDP fallback when both are present", () => {
    const appUrlDrift = buildAppUrlDrift("http://localhost:3000", "http://localhost:4173");
    const readiness = buildRunReadiness({
      appUrl: "http://localhost:3000",
      appUrlDrift,
      cdpReadiness: { ok: false, reason: "Connection refused" },
      activeSession: {
        sessionId: "session-2",
        state: "running",
        tabUrl: "http://localhost:4173",
        startedAt: "2026-02-18T00:00:00.000Z",
      },
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.modeHint).toBe("core");
    expect(readiness.reasons).toContain("app-url-drift:mismatch");
  });

  it("prioritizes session recovery over CDP fallback when session state is not running", () => {
    const appUrlDrift = buildAppUrlDrift("http://localhost:3000", "http://localhost:3000");
    const readiness = buildRunReadiness({
      appUrl: "http://localhost:3000",
      appUrlDrift,
      cdpReadiness: { ok: false, reason: "Connection refused" },
      activeSession: {
        sessionId: "session-3",
        state: "error",
        tabUrl: "http://localhost:3000",
        startedAt: "2026-02-18T00:00:00.000Z",
      },
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.reasons).toContain("session-state:error");
    expect(readiness.nextAction?.command).toContain("npm run agent:stop");
  });
});

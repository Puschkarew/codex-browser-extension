import { describe, expect, it } from "vitest";
import { buildAppUrlDrift } from "../src/agent/runtime.js";

describe("buildAppUrlDrift", () => {
  it("uses placeholder project root in remediation command for mismatch", () => {
    const drift = buildAppUrlDrift("http://localhost:3000", "http://localhost:4173");

    expect(drift.status).toBe("mismatch");
    expect(drift.recommendedCommand).toContain("--project-root <project-root>");
    expect(drift.recommendedCommand).not.toContain(process.cwd());
  });

  it("returns no recommended command when there is no active session", () => {
    const drift = buildAppUrlDrift("http://localhost:3000", null);

    expect(drift.status).toBe("no-active-session");
    expect(drift.recommendedCommand).toBeNull();
  });
});

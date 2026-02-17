import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  decideAutoRouting,
  isKpiSampleWindowValid,
  parseAutoRoutingEnabled,
} from "../src/shared/auto-routing.js";

describe("auto routing decision", () => {
  it("disables all auto routing when kill-switch is false", () => {
    const decision = decideAutoRouting({
      skill: "workflows-work",
      triggerClass: "runtime-bug",
      explicitRequest: true,
      killSwitchEnv: "false",
      capability: { canInstrumentFromBrowser: true, bootstrapStatus: "ok" },
    });

    expect(decision.ruleId).toBe("R1-KILL-SWITCH");
    expect(decision.autoInvoked).toBe(false);
    expect(decision.killSwitchState).toBe("disabled");
  });

  it("honors session opt-out tokens", () => {
    const decision = decideAutoRouting({
      skill: "workflows-work",
      triggerClass: "runtime-bug",
      explicitRequest: true,
      sessionHints: ["manual-only"],
      capability: { canInstrumentFromBrowser: true, bootstrapStatus: "ok" },
    });

    expect(decision.ruleId).toBe("R2-SESSION-OPTOUT");
    expect(decision.autoInvoked).toBe(false);
  });

  it("routes explicitly requested flows even when trigger profile does not match", () => {
    const decision = decideAutoRouting({
      skill: "security-sentinel",
      triggerClass: "non-runtime",
      explicitRequest: true,
      capability: { canInstrumentFromBrowser: true, bootstrapStatus: "ok" },
    });

    expect(decision.ruleId).toBe("R3-EXPLICIT-ROUTE");
    expect(decision.autoInvoked).toBe(true);
    expect(decision.modeSelected).toBe("core");
    expect(decision.outcomeStatus).toBe("success");
  });

  it("does not route unmatched trigger classes", () => {
    const decision = decideAutoRouting({
      skill: "workflows-review",
      triggerClass: "non-runtime",
      explicitRequest: false,
      capability: { canInstrumentFromBrowser: true, bootstrapStatus: "ok" },
    });

    expect(decision.ruleId).toBe("R5-NO-ROUTE");
    expect(decision.autoInvoked).toBe(false);
  });

  it("uses enhanced mode for strict evidence when instrumentation is available", () => {
    const decision = decideAutoRouting({
      skill: "workflows-work",
      triggerClass: "runtime-bug",
      explicitRequest: false,
      strictEvidenceRequired: true,
      capability: { canInstrumentFromBrowser: true, bootstrapStatus: "ok" },
    });

    expect(decision.modeSelected).toBe("enhanced");
    expect(decision.fallbackUsed).toBe(false);
    expect(decision.outcomeStatus).toBe("success");
  });

  it("falls back to terminal-probe when instrumentation cannot be used", () => {
    const decision = decideAutoRouting({
      skill: "workflows-work",
      triggerClass: "runtime-bug",
      explicitRequest: false,
      strictEvidenceRequired: true,
      capability: { canInstrumentFromBrowser: false, bootstrapStatus: "ok" },
    });

    expect(decision.modeSelected).toBe("terminal-probe");
    expect(decision.fallbackUsed).toBe(true);
    expect(decision.outcomeStatus).toBe("partial");
  });

  it("falls back to terminal-probe when bootstrap returns fallback status", () => {
    const decision = decideAutoRouting({
      skill: "workflows-work",
      triggerClass: "runtime-bug",
      explicitRequest: false,
      capability: { canInstrumentFromBrowser: true, bootstrapStatus: "fallback" },
    });

    expect(decision.modeSelected).toBe("terminal-probe");
    expect(decision.outcomeStatus).toBe("partial");
  });

  it("returns blocked when routing is required but capability verdict is missing", () => {
    const decision = decideAutoRouting({
      skill: "workflows-work",
      triggerClass: "runtime-bug",
      explicitRequest: true,
    });

    expect(decision.routingAttempted).toBe(true);
    expect(decision.outcomeStatus).toBe("blocked");
    expect(decision.modeSelected).toBe(null);
  });
});

describe("auto routing parsing and KPI gates", () => {
  it("treats missing or empty kill-switch env as enabled", () => {
    expect(parseAutoRoutingEnabled(undefined)).toBe(true);
    expect(parseAutoRoutingEnabled("")).toBe(true);
  });

  it("parses common false values for kill-switch", () => {
    expect(parseAutoRoutingEnabled("false")).toBe(false);
    expect(parseAutoRoutingEnabled("0")).toBe(false);
    expect(parseAutoRoutingEnabled("OFF")).toBe(false);
  });

  it("validates KPI sample window requirements", () => {
    expect(
      isKpiSampleWindowValid({
        totalRuns: 40,
        expectedRouteRuns: 20,
        expectedNoRouteRuns: 20,
        daySpan: 14,
      }),
    ).toBe(true);
  });

  it("rejects invalid KPI sample windows", () => {
    expect(
      isKpiSampleWindowValid({
        totalRuns: 39,
        expectedRouteRuns: 20,
        expectedNoRouteRuns: 20,
        daySpan: 14,
      }),
    ).toBe(false);
    expect(
      isKpiSampleWindowValid({
        totalRuns: 40,
        expectedRouteRuns: 19,
        expectedNoRouteRuns: 21,
        daySpan: 14,
      }),
    ).toBe(false);
    expect(
      isKpiSampleWindowValid({
        totalRuns: 40,
        expectedRouteRuns: 20,
        expectedNoRouteRuns: 20,
        daySpan: 13,
      }),
    ).toBe(false);
  });
});

describe("repo mirror routing contract docs", () => {
  const repoRoot = process.cwd();
  const contractPath = path.join(repoRoot, "docs", "contracts", "auto-routing-contract.md");
  const capabilityMapPath = path.join(repoRoot, "docs", "contracts", "auto-routing-capability-map.md");

  it("contains mirrored contract and kill-switch requirements", () => {
    expect(fs.existsSync(contractPath)).toBe(true);
    const text = fs.readFileSync(contractPath, "utf8");
    expect(text).toContain("EVERY_AUTO_ROUTING_ENABLED");
    expect(text).toContain("terminal-probe");
    expect(text).toContain("Routing Decision Precedence");
  });

  it("contains mirrored capability map with reviewer-gated routing", () => {
    expect(fs.existsSync(capabilityMapPath)).toBe(true);
    const text = fs.readFileSync(capabilityMapPath, "utf8");
    expect(text).toContain("security-sentinel");
    expect(text).toContain("performance-oracle");
    expect(text).toContain("review-needs-runtime");
  });
});

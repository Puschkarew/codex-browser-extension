export const SESSION_OPT_OUT_TOKENS = ["no-auto-routing", "manual-only", "skip-browser-debug"] as const;

export type TriggerClass =
  | "runtime-bug"
  | "visual-regression"
  | "repro-required"
  | "review-needs-runtime"
  | "non-runtime";

export type RoutingSkill =
  | "workflows-brainstorm"
  | "workflows-plan"
  | "workflows-work"
  | "workflows-review"
  | "bug-reproduction-validator"
  | "test-browser"
  | "playwright"
  | "security-sentinel"
  | "performance-oracle";

export const SKILL_TRIGGER_PROFILE: Record<RoutingSkill, readonly TriggerClass[]> = {
  "workflows-brainstorm": ["runtime-bug", "repro-required"],
  "workflows-plan": ["runtime-bug", "visual-regression", "repro-required"],
  "workflows-work": ["runtime-bug", "visual-regression", "repro-required"],
  "workflows-review": ["review-needs-runtime"],
  "bug-reproduction-validator": ["runtime-bug", "repro-required"],
  "test-browser": ["visual-regression", "repro-required"],
  "playwright": ["runtime-bug", "visual-regression", "repro-required"],
  "security-sentinel": ["review-needs-runtime"],
  "performance-oracle": ["review-needs-runtime"],
};

export interface RoutingCapabilityInput {
  canInstrumentFromBrowser: boolean;
  bootstrapStatus?: "ok" | "fallback";
}

export interface AutoRoutingInput {
  skill: RoutingSkill;
  triggerClass: TriggerClass;
  explicitRequest: boolean;
  sessionHints?: string[];
  strictEvidenceRequired?: boolean;
  killSwitchEnv?: string | undefined;
  capability?: RoutingCapabilityInput;
}

export type ModeSelected = "core" | "enhanced" | "terminal-probe";
export type RoutingAttemptStatus = "success" | "partial" | "blocked";
export type KillSwitchState = "enabled" | "disabled";

export interface AutoRoutingDecision {
  triggerMatched: boolean;
  triggerClass: TriggerClass;
  ruleId: string;
  autoInvoked: boolean;
  modeSelected: ModeSelected | null;
  fallbackUsed: boolean;
  killSwitchState: KillSwitchState;
  routingAttempted: boolean;
  outcomeStatus: RoutingAttemptStatus | null;
}

export interface KpiWindowInput {
  totalRuns: number;
  expectedRouteRuns: number;
  expectedNoRouteRuns: number;
  daySpan: number;
}

export function parseAutoRoutingEnabled(killSwitchEnv?: string): boolean {
  if (killSwitchEnv === undefined) return true;
  const normalized = killSwitchEnv.trim().toLowerCase();
  if (normalized === "") return true;
  return !["false", "0", "off", "disabled", "no"].includes(normalized);
}

export function hasSessionOptOut(sessionHints: string[] = []): boolean {
  const normalized = sessionHints.map((hint) => hint.trim().toLowerCase());
  return SESSION_OPT_OUT_TOKENS.some((token) => normalized.includes(token));
}

function isTriggerMatched(skill: RoutingSkill, triggerClass: TriggerClass): boolean {
  return SKILL_TRIGGER_PROFILE[skill].includes(triggerClass);
}

export function decideAutoRouting(input: AutoRoutingInput): AutoRoutingDecision {
  const enabled = parseAutoRoutingEnabled(input.killSwitchEnv);
  if (!enabled) {
    return {
      triggerMatched: false,
      triggerClass: input.triggerClass,
      ruleId: "R1-KILL-SWITCH",
      autoInvoked: false,
      modeSelected: null,
      fallbackUsed: false,
      killSwitchState: "disabled",
      routingAttempted: false,
      outcomeStatus: null,
    };
  }

  if (hasSessionOptOut(input.sessionHints)) {
    return {
      triggerMatched: false,
      triggerClass: input.triggerClass,
      ruleId: "R2-SESSION-OPTOUT",
      autoInvoked: false,
      modeSelected: null,
      fallbackUsed: false,
      killSwitchState: "enabled",
      routingAttempted: false,
      outcomeStatus: null,
    };
  }

  const profileMatched = isTriggerMatched(input.skill, input.triggerClass);
  const shouldRoute = input.explicitRequest || profileMatched;
  if (!shouldRoute) {
    return {
      triggerMatched: false,
      triggerClass: input.triggerClass,
      ruleId: "R5-NO-ROUTE",
      autoInvoked: false,
      modeSelected: null,
      fallbackUsed: false,
      killSwitchState: "enabled",
      routingAttempted: false,
      outcomeStatus: null,
    };
  }

  if (!input.capability) {
    return {
      triggerMatched: true,
      triggerClass: input.triggerClass,
      ruleId: input.explicitRequest ? "R3-EXPLICIT-ROUTE" : "R4-TRIGGER-MATCH",
      autoInvoked: true,
      modeSelected: null,
      fallbackUsed: false,
      killSwitchState: "enabled",
      routingAttempted: true,
      outcomeStatus: "blocked",
    };
  }

  const fallback = !input.capability.canInstrumentFromBrowser || input.capability.bootstrapStatus === "fallback";
  if (fallback) {
    return {
      triggerMatched: true,
      triggerClass: input.triggerClass,
      ruleId: input.explicitRequest ? "R3-EXPLICIT-ROUTE" : "R4-TRIGGER-MATCH",
      autoInvoked: true,
      modeSelected: "terminal-probe",
      fallbackUsed: true,
      killSwitchState: "enabled",
      routingAttempted: true,
      outcomeStatus: "partial",
    };
  }

  return {
    triggerMatched: true,
    triggerClass: input.triggerClass,
    ruleId: input.explicitRequest ? "R3-EXPLICIT-ROUTE" : "R4-TRIGGER-MATCH",
    autoInvoked: true,
    modeSelected: input.strictEvidenceRequired ? "enhanced" : "core",
    fallbackUsed: false,
    killSwitchState: "enabled",
    routingAttempted: true,
    outcomeStatus: "success",
  };
}

export function isKpiSampleWindowValid(input: KpiWindowInput): boolean {
  return (
    input.totalRuns >= 40 &&
    input.expectedRouteRuns >= 20 &&
    input.expectedNoRouteRuns >= 20 &&
    input.daySpan >= 14
  );
}

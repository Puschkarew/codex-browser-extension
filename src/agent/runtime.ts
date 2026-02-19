import rateLimit from "@fastify/rate-limit";
import Fastify, { FastifyInstance, FastifyReply } from "fastify";
import path from "node:path";
import {
  EvaluatePayloadSchema,
  NavigatePayloadSchema,
  ClickPayloadSchema,
  CompareReferencePayloadSchema,
  CommandRequestSchema,
  CoreEventsRequestSchema,
  DebugTraceBatchSchema,
  DebugTraceEvent,
  DebugTraceEventSchema,
  ProjectRuntimeConfigSchema,
  QueryRequestSchema,
  ReloadPayloadSchema,
  SessionEnsureRequestSchema,
  SessionStartRequestSchema,
  SessionStopRequestSchema,
  SnapshotPayloadSchema,
  TypePayloadSchema,
  WaitPayloadSchema,
  WebglDiagnosticsPayloadSchema,
} from "../shared/contracts.js";
import type { CompareDimensionPolicy, CommandRequest, ResizeInterpolation, SessionMatchStrategy } from "../shared/contracts.js";
import { AmbiguousTargetError, CdpController, CdpUnavailableError, CommandTimeoutError, TargetNotFoundError } from "./cdp-controller.js";
import { isAllowedHostname, isAllowedOrigin } from "./domain-match.js";
import { compareImages, ImageCompareError } from "./image-compare.js";
import { JsonlStore } from "./jsonl-store.js";
import { normalizeDebugTraceEvent, normalizeRuntimeEvent } from "./normalize.js";
import { RuntimeConfigState } from "./runtime-config.js";
import { SessionManager } from "./session-manager.js";

type RuntimeOptions = {
  host?: string;
  corePort?: number;
  debugPort?: number;
  rootDir?: string;
  logsDir?: string;
  retentionDays?: number;
};

type HealthResponse = {
  status: "ok";
  version: string;
  uptimeSec: number;
  corePort: number;
  debugPort: number;
  activeProjectId: string;
  appUrl: string;
  appUrlDrift: {
    status: "match" | "mismatch" | "no-active-session" | "invalid-url";
    matchType: "exact" | "loopback-equivalent" | "mismatch" | "not-evaluated";
    configAppUrl: string;
    activeSessionTabUrl: string | null;
    configOrigin: string | null;
    activeOrigin: string | null;
    reason: string | null;
    recommendedCommand: string | null;
  };
  activeSession: false | { sessionId: string; state: string; tabUrl: string; startedAt: string };
  readiness: {
    debug: boolean;
    query: boolean;
    cdp: boolean;
    cdpReason: string | null;
    cdpPort: number;
  };
  runReadiness: {
    status: "runnable" | "fallback" | "blocked";
    modeHint: "core" | "terminal-probe";
    reasons: string[];
    summary: string;
    nextAction: {
      label: string;
      hint: string;
      command: string | null;
    } | null;
  };
};

type SessionSummary = {
  sessionId: string;
  state: string;
  tabUrl: string;
  startedAt: string;
};

type RunReadinessInput = {
  appUrl: string;
  appUrlDrift: HealthResponse["appUrlDrift"];
  cdpReadiness: {
    ok: boolean;
    reason: string | null;
  };
  activeSession: false | SessionSummary;
};

function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown,
  nextAction: string | null = null,
): FastifyReply {
  return reply.code(statusCode).send({
    error: {
      code,
      message,
      reason: message,
      nextAction,
      details: details ?? {},
    },
  });
}

function isValidDateRange(from: string, to: string): boolean {
  const fromTs = new Date(from).getTime();
  const toTs = new Date(to).getTime();
  return !Number.isNaN(fromTs) && !Number.isNaN(toTs) && fromTs <= toTs;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseHostname(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

type UrlParts = {
  scheme: string;
  hostname: string;
  port: number;
  origin: string;
  pathname: string;
};

function parseUrlParts(rawUrl: string): UrlParts | null {
  try {
    const parsed = new URL(rawUrl);
    const scheme = parsed.protocol.replace(":", "").toLowerCase();
    const hostname = parsed.hostname.toLowerCase();
    const port =
      parsed.port.length > 0 ? Number(parsed.port) : scheme === "https" ? 443 : 80;
    if (!hostname || !Number.isInteger(port)) {
      return null;
    }
    return {
      scheme,
      hostname,
      port,
      origin: parsed.origin,
      pathname: parsed.pathname,
    };
  } catch {
    return null;
  }
}

function normalizeHostForMatch(hostname: string): string {
  return hostname === "localhost" || hostname === "127.0.0.1" ? "loopback" : hostname;
}

function buildBootstrapRemediationCommand(activeSessionTabUrl: string): string {
  return (
    "python3 \"${CODEX_HOME:-$HOME/.codex}/skills/fix-app-bugs/scripts/bootstrap_guarded.py\"" +
    " --project-root <project-root>" +
    ` --actual-app-url ${shellQuote(activeSessionTabUrl)}` +
    " --apply-recommended --json"
  );
}

function matchesSessionTarget(candidateUrl: string, requestedUrl: string, matchStrategy: SessionMatchStrategy): boolean {
  if (matchStrategy === "exact") {
    return candidateUrl === requestedUrl;
  }

  const candidate = parseUrlParts(candidateUrl);
  const requested = parseUrlParts(requestedUrl);
  if (!candidate || !requested) {
    return false;
  }

  if (matchStrategy === "origin-path") {
    return candidate.origin === requested.origin && candidate.pathname === requested.pathname;
  }

  return candidate.origin === requested.origin;
}

const SAFE_COMMAND_RETRY_SET = new Set<CommandRequest["command"]>([
  "reload",
  "wait",
  "navigate",
  "snapshot",
  "webgl-diagnostics",
]);

const STALE_CDP_ERROR_HINTS = [
  "websocket",
  "readystate",
  "closed",
  "target closed",
  "session closed",
  "cdp client is not attached",
  "socket hang up",
  "econnreset",
];

function errorToMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function buildAppUrlDrift(
  configAppUrl: string,
  activeSessionTabUrl: string | null,
): HealthResponse["appUrlDrift"] {
  const configParts = parseUrlParts(configAppUrl);
  const activeParts = activeSessionTabUrl ? parseUrlParts(activeSessionTabUrl) : null;

  if (!configParts) {
    return {
      status: "invalid-url",
      matchType: "not-evaluated",
      configAppUrl,
      activeSessionTabUrl,
      configOrigin: null,
      activeOrigin: activeParts?.origin ?? null,
      reason: "runtime config appUrl is invalid",
      recommendedCommand: null,
    };
  }

  if (!activeSessionTabUrl) {
    return {
      status: "no-active-session",
      matchType: "not-evaluated",
      configAppUrl,
      activeSessionTabUrl: null,
      configOrigin: configParts.origin,
      activeOrigin: null,
      reason: "no active session tab URL; drift cannot be evaluated yet",
      recommendedCommand: null,
    };
  }

  if (!activeParts) {
    return {
      status: "invalid-url",
      matchType: "not-evaluated",
      configAppUrl,
      activeSessionTabUrl,
      configOrigin: configParts.origin,
      activeOrigin: null,
      reason: "active session tab URL is invalid",
      recommendedCommand: null,
    };
  }

  const exactMatch =
    configParts.scheme === activeParts.scheme &&
    configParts.hostname === activeParts.hostname &&
    configParts.port === activeParts.port;

  const loopbackEquivalent =
    configParts.scheme === activeParts.scheme &&
    configParts.port === activeParts.port &&
    normalizeHostForMatch(configParts.hostname) === "loopback" &&
    normalizeHostForMatch(activeParts.hostname) === "loopback";

  if (exactMatch) {
    return {
      status: "match",
      matchType: "exact",
      configAppUrl,
      activeSessionTabUrl,
      configOrigin: configParts.origin,
      activeOrigin: activeParts.origin,
      reason: null,
      recommendedCommand: null,
    };
  }

  if (loopbackEquivalent) {
    const recommendedCommand = buildBootstrapRemediationCommand(activeSessionTabUrl);
    return {
      status: "match",
      matchType: "loopback-equivalent",
      configAppUrl,
      activeSessionTabUrl,
      configOrigin: configParts.origin,
      activeOrigin: activeParts.origin,
      reason: "loopback-equivalent origins detected; optional config sync recommended",
      recommendedCommand,
    };
  }

  const recommendedCommand = buildBootstrapRemediationCommand(activeSessionTabUrl);
  return {
    status: "mismatch",
    matchType: "mismatch",
    configAppUrl,
    activeSessionTabUrl,
    configOrigin: configParts.origin,
    activeOrigin: activeParts.origin,
    reason: `config origin ${configParts.origin} differs from active tab origin ${activeParts.origin}`,
    recommendedCommand,
  };
}

function buildStartSessionCommand(appUrl: string): string {
  return `npm run agent:session -- --tab-url ${shellQuote(appUrl)} --match-strategy origin-path`;
}

function buildSessionRecoveryCommand(appUrl: string): string {
  return `npm run agent:stop && ${buildStartSessionCommand(appUrl)}`;
}

function buildTerminalProbeStarterCommand(appUrl: string): string {
  return (
    "python3 \"${CODEX_HOME:-$HOME/.codex}/skills/fix-app-bugs/scripts/visual_debug_start.py\"" +
    " --project-root <project-root>" +
    ` --actual-app-url ${shellQuote(appUrl)}` +
    " --json"
  );
}

export function buildRunReadiness(input: RunReadinessInput): HealthResponse["runReadiness"] {
  if (input.appUrlDrift.status === "invalid-url") {
    return {
      status: "blocked",
      modeHint: "core",
      reasons: ["app-url-drift:invalid-url"],
      summary: "Runtime config appUrl is invalid and must be fixed before session actions.",
      nextAction: null,
    };
  }

  if (input.appUrlDrift.status === "mismatch") {
    return {
      status: "blocked",
      modeHint: "core",
      reasons: ["app-url-drift:mismatch"],
      summary: "Configured app URL differs from active session URL.",
      nextAction: {
        label: "Align app URL",
        hint: "Apply recommended app-url remediation and re-run readiness checks.",
        command: input.appUrlDrift.recommendedCommand,
      },
    };
  }

  if (input.activeSession && input.activeSession.state !== "running") {
    return {
      status: "blocked",
      modeHint: "core",
      reasons: [`session-state:${input.activeSession.state}`],
      summary: "Active session is not running; session recovery is required.",
      nextAction: {
        label: "Recover session",
        hint: "Stop the current session and ensure a fresh running session.",
        command: buildSessionRecoveryCommand(input.appUrl),
      },
    };
  }

  if (!input.cdpReadiness.ok) {
    const reason = input.cdpReadiness.reason ?? "unknown";
    return {
      status: "fallback",
      modeHint: "terminal-probe",
      reasons: [`cdp-unavailable:${reason}`],
      summary: "CDP is unavailable; use terminal-probe workflow until CDP recovers.",
      nextAction: {
        label: "Run terminal-probe starter",
        hint: "Continue with guarded starter in terminal-probe path.",
        command: buildTerminalProbeStarterCommand(input.appUrl),
      },
    };
  }

  if (!input.activeSession) {
    return {
      status: "runnable",
      modeHint: "core",
      reasons: ["session:none"],
      summary: "Runtime is healthy; start a session to run commands.",
      nextAction: {
        label: "Start session",
        hint: "Start or ensure a session for the target app URL.",
        command: buildStartSessionCommand(input.appUrl),
      },
    };
  }

  if (input.appUrlDrift.matchType === "loopback-equivalent") {
    return {
      status: "runnable",
      modeHint: "core",
      reasons: ["app-url-drift:loopback-equivalent"],
      summary: "Session is runnable; optional app URL sync can improve deterministic reruns.",
      nextAction: {
        label: "Optional app URL sync",
        hint: "Optionally align config appUrl with active loopback URL.",
        command: input.appUrlDrift.recommendedCommand,
      },
    };
  }

  return {
    status: "runnable",
    modeHint: "core",
    reasons: [],
    summary: "Session and CDP are healthy; scenario commands can run.",
    nextAction: null,
  };
}

function getBoundPort(server: FastifyInstance, fallbackPort: number): number {
  const address = server.server.address();
  if (typeof address === "object" && typeof address?.port === "number") {
    return address.port;
  }
  return fallbackPort;
}

function getHeaderValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function setCorsAllowOrigin(reply: FastifyReply, origin: string | undefined): void {
  if (!origin) {
    return;
  }
  reply.header("Access-Control-Allow-Origin", origin);
  reply.header("Vary", "Origin");
}

function setCorsPreflightHeaders(
  reply: FastifyReply,
  origin: string | undefined,
  requestHeaders: string | undefined,
): void {
  setCorsAllowOrigin(reply, origin);
  reply.header("Access-Control-Allow-Methods", "POST,OPTIONS");
  reply.header("Access-Control-Allow-Headers", requestHeaders ?? "content-type");
  reply.header("Vary", "Origin, Access-Control-Request-Headers");
}

export class AgentRuntime {
  private readonly host: string;
  private readonly corePort: number;
  private readonly debugPort: number;
  private readonly rootDir: string;
  private readonly retentionDays: number;

  private readonly sessionManager = new SessionManager();
  private readonly cdpController = new CdpController();
  private readonly store: JsonlStore;
  private readonly runtimeConfigState: RuntimeConfigState;

  private readonly coreServer: FastifyInstance;
  private readonly debugServer: FastifyInstance;

  private retentionTimer: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();

  constructor(options: RuntimeOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.corePort = options.corePort ?? 4678;
    this.debugPort = options.debugPort ?? 7331;
    this.rootDir = options.rootDir ?? process.cwd();
    this.retentionDays = options.retentionDays ?? 7;

    const logsDir = options.logsDir ?? path.join(this.rootDir, "logs", "browser-debug");
    this.store = new JsonlStore(logsDir);

    this.runtimeConfigState = new RuntimeConfigState({
      rootDir: this.rootDir,
      host: this.host,
      corePort: this.corePort,
      debugPort: this.debugPort,
    });

    this.coreServer = Fastify({
      logger: true,
      bodyLimit: 1_048_576,
    });

    this.debugServer = Fastify({
      logger: true,
      bodyLimit: 32_768,
    });

    this.registerServerErrorHandlers();
    this.registerCoreRoutes();
    this.registerDebugRoutes();
  }

  getCoreUrl(): string {
    const address = this.coreServer.server.address();
    if (typeof address === "object" && address?.port) {
      return `http://${this.host}:${address.port}`;
    }
    return `http://${this.host}:${this.corePort}`;
  }

  getDebugUrl(): string {
    const address = this.debugServer.server.address();
    if (typeof address === "object" && address?.port) {
      return `http://${this.host}:${address.port}`;
    }
    return `http://${this.host}:${this.debugPort}`;
  }

  async start(): Promise<void> {
    await this.coreServer.listen({ host: this.host, port: this.corePort });
    await this.debugServer.listen({ host: this.host, port: this.debugPort });

    this.retentionTimer = setInterval(() => {
      this.store.cleanupOlderThan(this.retentionDays);
    }, 60 * 60 * 1000);

    this.retentionTimer.unref();
  }

  async stop(): Promise<void> {
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer);
      this.retentionTimer = null;
    }

    await this.cdpController.detach();
    await Promise.all([this.coreServer.close(), this.debugServer.close()]);
  }

  private registerServerErrorHandlers(): void {
    const setHandler = (server: FastifyInstance, serverId: "core" | "debug") => {
      server.setErrorHandler((error, _request, reply) => {
        server.log.error(error);
        if (reply.sent) {
          return;
        }
        sendError(
          reply,
          500,
          "INTERNAL_ERROR",
          "Unhandled server error",
          {
            server: serverId,
            reason: error?.message ?? String(error),
          },
          "check-agent-log",
        );
      });
    };

    setHandler(this.coreServer, "core");
    setHandler(this.debugServer, "debug");
  }

  private activeSessionDetails(): {
    activeSessionId: string | null;
    activeState: string | null;
    activeTabUrl: string | null;
  } {
    const active = this.sessionManager.getActive();
    if (!active) {
      return {
        activeSessionId: null,
        activeState: null,
        activeTabUrl: null,
      };
    }
    return {
      activeSessionId: active.sessionId,
      activeState: active.state,
      activeTabUrl: active.attachedTargetUrl ?? active.tabUrl,
    };
  }

  private sendSessionNotFound(
    reply: FastifyReply,
    requestedSessionId: string | undefined,
    nextAction = "start-or-ensure-session",
  ): FastifyReply {
    return sendError(
      reply,
      404,
      "SESSION_NOT_FOUND",
      "Session was not found",
      {
        requestedSessionId: requestedSessionId ?? null,
        ...this.activeSessionDetails(),
      },
      nextAction,
    );
  }

  private validateSessionTargetOrReply(
    reply: FastifyReply,
    tabUrl: string,
    debugPort: number,
    matchStrategy: SessionMatchStrategy,
  ): { tabUrl: string; debugPort: number; matchStrategy: SessionMatchStrategy } | FastifyReply {
    const hostname = parseHostname(tabUrl);
    if (!hostname) {
      return sendError(reply, 422, "VALIDATION_ERROR", "tabUrl must be a valid URL");
    }

    if (!isAllowedHostname(hostname, this.runtimeConfigState.getAllowedDomains())) {
      return sendError(reply, 403, "DOMAIN_NOT_ALLOWED", "Domain is not allowlisted", {
        hostname,
        allowedDomains: this.runtimeConfigState.getAllowedDomains(),
      });
    }

    return {
      tabUrl,
      debugPort,
      matchStrategy,
    };
  }

  private async stopActiveSessionIfAny(): Promise<void> {
    const active = this.sessionManager.getActive();
    if (!active) {
      return;
    }

    try {
      await this.cdpController.detach();
    } catch {
      // ignore detach failures during recovery
    }

    try {
      this.sessionManager.stop(active.sessionId);
    } catch {
      // ignore stale session state during recovery
    }
  }

  private async startFreshSession(tabUrl: string, debugPort: number, matchStrategy: SessionMatchStrategy): Promise<{
    sessionId: string;
    ingestToken: string;
    state: string;
    attachedTargetUrl: string;
    reused: boolean;
  }> {
    this.sessionManager.startStarting(tabUrl, debugPort);

    let attachedTargetUrl: string | null = null;
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        attachedTargetUrl = await this.cdpController.attach({
          tabUrlPattern: tabUrl,
          debugPort,
          matchStrategy,
        });
        break;
      } catch (error) {
        lastError = error;
        await sleep(500);
      }
    }

    if (!attachedTargetUrl) {
      this.sessionManager.markError();
      if (lastError instanceof TargetNotFoundError) {
        throw lastError;
      }
      if (lastError instanceof AmbiguousTargetError) {
        throw lastError;
      }
      throw new CdpUnavailableError(String(lastError));
    }

    const running = this.sessionManager.markRunning(attachedTargetUrl);
    return {
      sessionId: running.sessionId,
      ingestToken: running.ingestToken,
      state: running.state,
      attachedTargetUrl,
      reused: false,
    };
  }

  private async ensureSession(
    tabUrl: string,
    debugPort: number,
    reuseActive: boolean,
    matchStrategy: SessionMatchStrategy,
  ): Promise<{
    sessionId: string;
    ingestToken: string;
    state: string;
    attachedTargetUrl: string;
    reused: boolean;
  }> {
    const active = this.sessionManager.getActive();
    if (active && active.state === "running" && this.cdpController.hasConnection()) {
      const activeTarget = active.attachedTargetUrl ?? active.tabUrl;
      const sameTarget =
        matchesSessionTarget(activeTarget, tabUrl, matchStrategy) ||
        matchesSessionTarget(active.tabUrl, tabUrl, matchStrategy);
      if (reuseActive && sameTarget) {
        return {
          sessionId: active.sessionId,
          ingestToken: active.ingestToken,
          state: active.state,
          attachedTargetUrl: activeTarget,
          reused: true,
        };
      }
      if (!reuseActive) {
        throw new Error("SESSION_ALREADY_RUNNING");
      }
      await this.stopActiveSessionIfAny();
    } else if (active) {
      await this.stopActiveSessionIfAny();
    }

    return this.startFreshSession(tabUrl, debugPort, matchStrategy);
  }

  private isSafeCommandForRetry(command: CommandRequest["command"]): boolean {
    return SAFE_COMMAND_RETRY_SET.has(command);
  }

  private isLikelyStaleCdpError(error: unknown): boolean {
    if (error instanceof CommandTimeoutError) {
      return false;
    }
    const message = errorToMessage(error).toLowerCase();
    return STALE_CDP_ERROR_HINTS.some((hint) => message.includes(hint));
  }

  private async recoverActiveCommandChannel(): Promise<boolean> {
    const active = this.sessionManager.getActive();
    if (!active) {
      return false;
    }

    const exactTarget = active.attachedTargetUrl ?? active.tabUrl;
    const attachAttempts: Array<{ tabUrlPattern: string; matchStrategy: SessionMatchStrategy }> = [
      { tabUrlPattern: exactTarget, matchStrategy: "exact" },
    ];
    if (exactTarget !== active.tabUrl) {
      attachAttempts.push({ tabUrlPattern: active.tabUrl, matchStrategy: "origin-path" });
    }

    try {
      await this.cdpController.detach();
    } catch {
      // best-effort cleanup before reattach
    }

    for (const attempt of attachAttempts) {
      try {
        const attachedTargetUrl = await this.cdpController.attach({
          tabUrlPattern: attempt.tabUrlPattern,
          debugPort: active.debugPort,
          matchStrategy: attempt.matchStrategy,
        });
        this.sessionManager.markRunning(attachedTargetUrl);
        return true;
      } catch {
        // try the next attach strategy
      }
    }

    this.sessionManager.markError();
    return false;
  }

  private registerCoreRoutes(): void {
    this.coreServer.get("/health", async (): Promise<HealthResponse> => {
      const active = this.sessionManager.getActive();
      const runtimeConfig = this.runtimeConfigState.get();
      const cdpPort = runtimeConfig.browser.cdpPort;
      const cdpReadiness = await this.probeCdpReadiness(cdpPort);
      const appUrlDrift = buildAppUrlDrift(runtimeConfig.appUrl, active?.tabUrl ?? null);
      const activeSession = active
        ? {
            sessionId: active.sessionId,
            state: active.state,
            tabUrl: active.tabUrl,
            startedAt: active.startedAt,
          }
        : false;
      const runReadiness = buildRunReadiness({
        appUrl: runtimeConfig.appUrl,
        appUrlDrift,
        cdpReadiness,
        activeSession,
      });

      return {
        status: "ok",
        version: "1.0.0",
        uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
        corePort: getBoundPort(this.coreServer, this.corePort),
        debugPort: getBoundPort(this.debugServer, this.debugPort),
        activeProjectId: runtimeConfig.projectId,
        appUrl: runtimeConfig.appUrl,
        appUrlDrift,
        activeSession,
        readiness: {
          debug: true,
          query: true,
          cdp: cdpReadiness.ok,
          cdpReason: cdpReadiness.ok ? null : cdpReadiness.reason,
          cdpPort,
        },
        runReadiness,
      };
    });

    this.coreServer.get("/runtime/config", async (_request, reply) => {
      return reply.code(200).send(this.runtimeConfigState.get());
    });

    this.coreServer.post("/runtime/config", async (request, reply) => {
      const parsed = ProjectRuntimeConfigSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 422, "VALIDATION_ERROR", "Invalid /runtime/config payload", parsed.error.flatten());
      }

      const updated = this.runtimeConfigState.set(parsed.data);
      return reply.code(200).send(updated);
    });

    this.coreServer.post("/session/start", async (request, reply) => {
      const parsed = SessionStartRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 422, "VALIDATION_ERROR", "Invalid /session/start payload", parsed.error.flatten());
      }

      const target = this.validateSessionTargetOrReply(
        reply,
        parsed.data.tabUrl,
        parsed.data.debugPort,
        parsed.data.matchStrategy,
      );
      if (!("tabUrl" in target)) {
        return target;
      }

      try {
        const session = await this.ensureSession(target.tabUrl, target.debugPort, false, target.matchStrategy);
        return reply.code(200).send({
          sessionId: session.sessionId,
          ingestToken: session.ingestToken,
          state: session.state,
          attachedTargetUrl: session.attachedTargetUrl,
          reused: false,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "SESSION_ALREADY_RUNNING") {
          return sendError(
            reply,
            409,
            "SESSION_ALREADY_RUNNING",
            "A session is already running",
            this.activeSessionDetails(),
            "use-session-ensure-or-stop",
          );
        }
        if (error instanceof TargetNotFoundError) {
          return sendError(reply, 404, "TARGET_NOT_FOUND", "No matching tab found for tabUrl");
        }
        if (error instanceof AmbiguousTargetError) {
          return sendError(reply, 409, "AMBIGUOUS_TARGET", "Multiple tabs match tabUrl", {
            tabUrl: target.tabUrl,
            matchStrategy: target.matchStrategy,
            candidates: error.candidates,
          });
        }
        if (error instanceof CdpUnavailableError) {
          return sendError(reply, 503, "CDP_UNAVAILABLE", "Unable to connect to CDP", { reason: error.message });
        }
        return sendError(reply, 422, "VALIDATION_ERROR", "Session start failed", { reason: String(error) });
      }
    });

    this.coreServer.post("/session/ensure", async (request, reply) => {
      const parsed = SessionEnsureRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 422, "VALIDATION_ERROR", "Invalid /session/ensure payload", parsed.error.flatten());
      }

      const target = this.validateSessionTargetOrReply(
        reply,
        parsed.data.tabUrl,
        parsed.data.debugPort,
        parsed.data.matchStrategy,
      );
      if (!("tabUrl" in target)) {
        return target;
      }

      try {
        const session = await this.ensureSession(
          target.tabUrl,
          target.debugPort,
          parsed.data.reuseActive,
          target.matchStrategy,
        );
        return reply.code(200).send({
          sessionId: session.sessionId,
          ingestToken: session.ingestToken,
          state: session.state,
          attachedTargetUrl: session.attachedTargetUrl,
          reused: session.reused,
        });
      } catch (error) {
        if (error instanceof Error && error.message === "SESSION_ALREADY_RUNNING") {
          return sendError(
            reply,
            409,
            "SESSION_ALREADY_RUNNING",
            "A session is already running",
            this.activeSessionDetails(),
            "set-reuseActive-true-or-stop-session",
          );
        }
        if (error instanceof TargetNotFoundError) {
          return sendError(reply, 404, "TARGET_NOT_FOUND", "No matching tab found for tabUrl");
        }
        if (error instanceof AmbiguousTargetError) {
          return sendError(reply, 409, "AMBIGUOUS_TARGET", "Multiple tabs match tabUrl", {
            tabUrl: target.tabUrl,
            matchStrategy: target.matchStrategy,
            candidates: error.candidates,
          });
        }
        if (error instanceof CdpUnavailableError) {
          return sendError(reply, 503, "CDP_UNAVAILABLE", "Unable to connect to CDP", { reason: error.message });
        }
        return sendError(reply, 422, "VALIDATION_ERROR", "Session ensure failed", { reason: String(error) });
      }
    });

    this.coreServer.post("/session/stop", async (request, reply) => {
      const parsed = SessionStopRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 422, "VALIDATION_ERROR", "Invalid /session/stop payload", parsed.error.flatten());
      }

      try {
        await this.cdpController.detach();
        const stopped = this.sessionManager.stop(parsed.data.sessionId);
        return reply.code(200).send({
          sessionId: stopped.sessionId,
          state: stopped.state,
        });
      } catch {
        return this.sendSessionNotFound(reply, parsed.data.sessionId, "ensure-session");
      }
    });

    this.coreServer.post("/events", async (request, reply) => {
      const parsed = CoreEventsRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 422, "VALIDATION_ERROR", "Invalid /events payload", parsed.error.flatten());
      }

      const ingestToken = request.headers["x-ingest-token"];
      const token = Array.isArray(ingestToken) ? ingestToken[0] : ingestToken;

      if (!token || !this.sessionManager.validateIngest(parsed.data.sessionId, token)) {
        return sendError(reply, 401, "INVALID_INGEST_TOKEN", "Invalid ingest token");
      }

      const events = parsed.data.events.map((event) => normalizeRuntimeEvent(event, parsed.data.sessionId));
      this.store.appendEvents(events);

      return reply.code(202).send({
        accepted: events.length,
        rejected: 0,
      });
    });

    this.coreServer.get("/events/query", async (request, reply) => {
      const parsed = QueryRequestSchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 422, "VALIDATION_ERROR", "Invalid query params", parsed.error.flatten());
      }

      if (!isValidDateRange(parsed.data.from, parsed.data.to)) {
        return sendError(reply, 422, "VALIDATION_ERROR", "Query date range is invalid");
      }

      const result = this.store.query(parsed.data);
      return reply.code(200).send(result);
    });

    this.coreServer.post("/command", async (request, reply) => {
      const parsed = CommandRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 422, "VALIDATION_ERROR", "Invalid /command payload", parsed.error.flatten());
      }

      const command = parsed.data.command;
      const isCompareReference = command === "compare-reference";
      const active = this.sessionManager.getActive();
      const requestedSessionId = parsed.data.sessionId;
      const activeSessionId = active?.sessionId;

      let eventSessionId = requestedSessionId ?? this.sessionManager.resolveSessionId();

      if (!isCompareReference) {
        const commandSessionId = requestedSessionId ?? activeSessionId;
        if (!commandSessionId) {
          return this.sendSessionNotFound(reply, requestedSessionId, "ensure-session");
        }
        if (!active || active.sessionId !== commandSessionId) {
          return this.sendSessionNotFound(reply, commandSessionId, "ensure-session");
        }
        if (!this.cdpController.hasConnection()) {
          const recovered = this.isSafeCommandForRetry(command) ? await this.recoverActiveCommandChannel() : false;
          if (!recovered) {
            return sendError(
              reply,
              503,
              "CDP_UNAVAILABLE",
              "No attached CDP target",
              this.activeSessionDetails(),
              "ensure-session",
            );
          }
        }
        eventSessionId = commandSessionId;
      }

      try {
        const executeCommand = async (): Promise<Record<string, unknown>> => {
          if (command === "reload") {
            const payload = ReloadPayloadSchema.parse(parsed.data.payload);
            return this.cdpController.reload(payload.timeoutMs);
          }
          if (command === "wait") {
            const payload = WaitPayloadSchema.parse(parsed.data.payload);
            return this.cdpController.wait(payload.ms);
          }
          if (command === "navigate") {
            const payload = NavigatePayloadSchema.parse(parsed.data.payload);
            return this.cdpController.navigate(payload.url, payload.timeoutMs);
          }
          if (command === "evaluate") {
            const payload = EvaluatePayloadSchema.parse(parsed.data.payload);
            return this.cdpController.evaluate(
              payload.expression,
              payload.returnByValue,
              payload.awaitPromise,
              payload.timeoutMs,
            );
          }
          if (command === "click") {
            const payload = ClickPayloadSchema.parse(parsed.data.payload);
            return this.cdpController.click(payload.selector, payload.timeoutMs);
          }
          if (command === "type") {
            const payload = TypePayloadSchema.parse(parsed.data.payload);
            return this.cdpController.type(payload.selector, payload.text, payload.clear, payload.timeoutMs);
          }
          if (command === "snapshot") {
            const payload = SnapshotPayloadSchema.parse(parsed.data.payload);
            const screenshotData = await this.cdpController.snapshot(payload.timeoutMs);
            const screenshotPath = this.store.saveScreenshot(eventSessionId, screenshotData);
            return { path: screenshotPath };
          }
          if (command === "compare-reference") {
            const payload = CompareReferencePayloadSchema.parse(parsed.data.payload);
            return this.runCompareReference(eventSessionId, payload);
          }
          if (command === "webgl-diagnostics") {
            const payload = WebglDiagnosticsPayloadSchema.parse(parsed.data.payload);
            return this.cdpController.webglDiagnostics(payload.timeoutMs);
          }
          return { ok: true };
        };

        let recovery: { attempted: boolean; recovered: boolean } | null = null;
        let result: Record<string, unknown>;
        try {
          result = await executeCommand();
        } catch (error) {
          const safeRetry = !isCompareReference && this.isSafeCommandForRetry(command);
          if (safeRetry && this.isLikelyStaleCdpError(error)) {
            const recovered = await this.recoverActiveCommandChannel();
            recovery = { attempted: true, recovered };
            if (recovered) {
              result = await executeCommand();
            } else {
              throw new CdpUnavailableError(errorToMessage(error));
            }
          } else {
            throw error;
          }
        }

        this.store.appendEvent(
          normalizeRuntimeEvent(
            {
              eventType: "command",
              level: "info",
              message: `command:${command}`,
              data: {
                command,
                payload: parsed.data.payload,
                result,
                recovery: recovery ?? undefined,
              },
            },
            eventSessionId,
          ),
        );

        return reply.code(200).send({ ok: true, result });
      } catch (error) {
        if (error instanceof ImageCompareError) {
          return sendError(reply, error.statusCode, error.code, error.message, error.details);
        }

        if (error instanceof CommandTimeoutError) {
          return sendError(reply, 504, "COMMAND_TIMEOUT", "Command timed out");
        }

        if (error instanceof CdpUnavailableError) {
          return sendError(reply, 503, "CDP_UNAVAILABLE", "CDP command failed", { reason: error.message }, "ensure-session");
        }

        if (this.isLikelyStaleCdpError(error)) {
          return sendError(
            reply,
            503,
            "CDP_UNAVAILABLE",
            "CDP command failed",
            { reason: errorToMessage(error) },
            "ensure-session",
          );
        }

        return sendError(reply, 422, "VALIDATION_ERROR", "Command failed", { reason: String(error) });
      }
    });
  }

  private runCompareReference(
    sessionId: string,
    payload: {
      actualImagePath: string;
      referenceImagePath: string;
      label?: string;
      writeDiff: boolean;
      dimensionPolicy: CompareDimensionPolicy;
      resizeInterpolation: ResizeInterpolation;
    },
  ): Record<string, unknown> {
    const compared = compareImages({
      actualImagePath: payload.actualImagePath,
      referenceImagePath: payload.referenceImagePath,
      writeDiff: payload.writeDiff,
      dimensionPolicy: payload.dimensionPolicy,
      resizeInterpolation: payload.resizeInterpolation,
    });

    const run = this.store.createArtifactRun(sessionId, payload.label ?? "compare-reference");

    const actualImagePath = this.store.writeArtifactBinary(run, "actual.png", compared.actualPng);
    const referenceImagePath = this.store.writeArtifactBinary(run, "reference.png", compared.referencePng);
    const diffImagePath = compared.diffPng ? this.store.writeArtifactBinary(run, "diff.png", compared.diffPng) : null;

    const runtimeJsonPath = this.store.writeArtifactJson(run, "runtime.json", {
      command: "compare-reference",
      sessionId,
      runId: run.runId,
      createdAt: run.createdAt,
      label: run.label,
      input: {
        actualImagePath: compared.actualResolvedPath,
        referenceImagePath: compared.referenceResolvedPath,
        actualFormat: compared.actualFormat,
        referenceFormat: compared.referenceFormat,
        writeDiff: payload.writeDiff,
        dimensionPolicy: payload.dimensionPolicy,
        resizeInterpolation: payload.resizeInterpolation,
      },
      output: {
        actualImagePath,
        referenceImagePath,
        diffImagePath,
      },
    });

    const metricsJsonPath = this.store.writeArtifactJson(run, "metrics.json", compared.metrics);

    const summaryJsonPath = this.store.writeArtifactJson(run, "summary.json", {
      command: "compare-reference",
      sessionId,
      runId: run.runId,
      artifactDir: run.dir,
      metrics: compared.metrics,
      artifacts: {
        runtimeJsonPath,
        metricsJsonPath,
        actualImagePath,
        referenceImagePath,
        diffImagePath,
      },
    });

    return {
      runId: run.runId,
      artifactDir: run.dir,
      metrics: compared.metrics,
      artifacts: {
        runtimeJsonPath,
        metricsJsonPath,
        summaryJsonPath,
        actualImagePath,
        referenceImagePath,
        diffImagePath,
      },
    };
  }

  private registerDebugRoutes(): void {
    void this.debugServer.register(rateLimit, {
      global: true,
      max: 60,
      timeWindow: "1 minute",
    });

    this.debugServer.options("/debug", async (request, reply) => {
      const originHeader = getHeaderValue(request.headers.origin);
      const allowedDomains = this.runtimeConfigState.getAllowedDomains();

      if (!isAllowedOrigin(originHeader, allowedDomains)) {
        return sendError(reply, 403, "CORS_POLICY_BLOCKED_PATH", "CORS preflight blocked for /debug", {
          path: "/debug",
          origin: originHeader ?? null,
          allowedDomains,
        });
      }

      const requestedHeaders = getHeaderValue(request.headers["access-control-request-headers"]);
      setCorsPreflightHeaders(reply, originHeader, requestedHeaders);
      return reply.code(204).send();
    });

    this.debugServer.post("/debug", async (request, reply) => {
      const originHeader = getHeaderValue(request.headers.origin);

      if (!isAllowedOrigin(originHeader, this.runtimeConfigState.getAllowedDomains())) {
        return sendError(reply, 403, "ORIGIN_NOT_ALLOWED", "Origin is not allowlisted");
      }

      setCorsAllowOrigin(reply, originHeader);

      let parsedBody: unknown = request.body;
      if (typeof parsedBody === "string") {
        try {
          parsedBody = JSON.parse(parsedBody);
        } catch {
          return sendError(reply, 422, "VALIDATION_ERROR", "Invalid text/plain JSON payload");
        }
      }

      const body = parsedBody as Record<string, unknown>;
      const hasBatch = body && typeof body === "object" && Array.isArray(body.events);

      let sharedSessionId: string | undefined;
      let events: DebugTraceEvent[] = [];

      if (hasBatch) {
        const parsedBatch = DebugTraceBatchSchema.safeParse(body);
        if (!parsedBatch.success) {
          return sendError(
            reply,
            422,
            "VALIDATION_ERROR",
            "Invalid debug trace batch",
            parsedBatch.error.flatten(),
          );
        }
        sharedSessionId = parsedBatch.data.sessionId;
        events = parsedBatch.data.events;
      } else {
        const parsedSingle = DebugTraceEventSchema.safeParse(body);
        if (!parsedSingle.success) {
          return sendError(
            reply,
            422,
            "VALIDATION_ERROR",
            "Invalid debug trace event",
            parsedSingle.error.flatten(),
          );
        }
        events = [parsedSingle.data];
      }

      const normalized = events.map((event) => {
        const sessionId = this.sessionManager.resolveSessionId(event.sessionId ?? sharedSessionId);
        return normalizeDebugTraceEvent(event, sessionId);
      });

      this.store.appendEvents(normalized);

      return reply.code(202).send({ accepted: normalized.length, rejected: 0 });
    });
  }

  private async probeCdpReadiness(cdpPort: number): Promise<{ ok: boolean; reason: string | null }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 500);
    timeout.unref();

    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        return { ok: false, reason: `HTTP_${response.status}` };
      }

      return { ok: true, reason: null };
    } catch (error) {
      if (error instanceof Error) {
        return { ok: false, reason: error.message };
      }

      return { ok: false, reason: String(error) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

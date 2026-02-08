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
import { CdpController, CdpUnavailableError, CommandTimeoutError, TargetNotFoundError } from "./cdp-controller.js";
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
  activeSession: false | { sessionId: string; state: string; tabUrl: string; startedAt: string };
  readiness: {
    debug: boolean;
    query: boolean;
    cdp: boolean;
    cdpReason: string | null;
    cdpPort: number;
  };
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
  ): { tabUrl: string; debugPort: number } | FastifyReply {
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

  private async startFreshSession(tabUrl: string, debugPort: number): Promise<{
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

  private async ensureSession(tabUrl: string, debugPort: number, reuseActive: boolean): Promise<{
    sessionId: string;
    ingestToken: string;
    state: string;
    attachedTargetUrl: string;
    reused: boolean;
  }> {
    const active = this.sessionManager.getActive();
    if (active && active.state === "running" && this.cdpController.hasConnection()) {
      const activeTarget = active.attachedTargetUrl ?? active.tabUrl;
      const sameTarget = activeTarget === tabUrl || active.tabUrl === tabUrl;
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

    return this.startFreshSession(tabUrl, debugPort);
  }

  private registerCoreRoutes(): void {
    this.coreServer.get("/health", async (): Promise<HealthResponse> => {
      const active = this.sessionManager.getActive();
      const runtimeConfig = this.runtimeConfigState.get();
      const cdpPort = runtimeConfig.browser.cdpPort;
      const cdpReadiness = await this.probeCdpReadiness(cdpPort);

      return {
        status: "ok",
        version: "1.0.0",
        uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
        corePort: getBoundPort(this.coreServer, this.corePort),
        debugPort: getBoundPort(this.debugServer, this.debugPort),
        activeProjectId: runtimeConfig.projectId,
        appUrl: runtimeConfig.appUrl,
        activeSession: active
          ? {
              sessionId: active.sessionId,
              state: active.state,
              tabUrl: active.tabUrl,
              startedAt: active.startedAt,
            }
          : false,
        readiness: {
          debug: true,
          query: true,
          cdp: cdpReadiness.ok,
          cdpReason: cdpReadiness.ok ? null : cdpReadiness.reason,
          cdpPort,
        },
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

      const target = this.validateSessionTargetOrReply(reply, parsed.data.tabUrl, parsed.data.debugPort);
      if (!("tabUrl" in target)) {
        return target;
      }

      try {
        const session = await this.ensureSession(target.tabUrl, target.debugPort, false);
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

      const target = this.validateSessionTargetOrReply(reply, parsed.data.tabUrl, parsed.data.debugPort);
      if (!("tabUrl" in target)) {
        return target;
      }

      try {
        const session = await this.ensureSession(target.tabUrl, target.debugPort, parsed.data.reuseActive);
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
          return sendError(reply, 503, "CDP_UNAVAILABLE", "No attached CDP target", this.activeSessionDetails(), "ensure-session");
        }
        eventSessionId = commandSessionId;
      }

      try {
        let result: Record<string, unknown> = { ok: true };

        if (command === "reload") {
          const payload = ReloadPayloadSchema.parse(parsed.data.payload);
          result = await this.cdpController.reload(payload.timeoutMs);
        } else if (command === "wait") {
          const payload = WaitPayloadSchema.parse(parsed.data.payload);
          result = await this.cdpController.wait(payload.ms);
        } else if (command === "navigate") {
          const payload = NavigatePayloadSchema.parse(parsed.data.payload);
          result = await this.cdpController.navigate(payload.url, payload.timeoutMs);
        } else if (command === "evaluate") {
          const payload = EvaluatePayloadSchema.parse(parsed.data.payload);
          result = await this.cdpController.evaluate(
            payload.expression,
            payload.returnByValue,
            payload.awaitPromise,
            payload.timeoutMs,
          );
        } else if (command === "click") {
          const payload = ClickPayloadSchema.parse(parsed.data.payload);
          result = await this.cdpController.click(payload.selector, payload.timeoutMs);
        } else if (command === "type") {
          const payload = TypePayloadSchema.parse(parsed.data.payload);
          result = await this.cdpController.type(payload.selector, payload.text, payload.clear, payload.timeoutMs);
        } else if (command === "snapshot") {
          const payload = SnapshotPayloadSchema.parse(parsed.data.payload);
          const screenshotData = await this.cdpController.snapshot(payload.timeoutMs);
          const screenshotPath = this.store.saveScreenshot(eventSessionId, screenshotData);
          result = { path: screenshotPath };
        } else if (command === "compare-reference") {
          const payload = CompareReferencePayloadSchema.parse(parsed.data.payload);
          result = this.runCompareReference(eventSessionId, payload);
        } else if (command === "webgl-diagnostics") {
          const payload = WebglDiagnosticsPayloadSchema.parse(parsed.data.payload);
          const diagnostics = await this.cdpController.webglDiagnostics(payload.timeoutMs);
          result = diagnostics;
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
    },
  ): Record<string, unknown> {
    const compared = compareImages({
      actualImagePath: payload.actualImagePath,
      referenceImagePath: payload.referenceImagePath,
      writeDiff: payload.writeDiff,
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

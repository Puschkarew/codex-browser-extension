import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { AgentRuntime } from "../src/agent/runtime.js";

type RuntimeContext = {
  runtime: AgentRuntime;
  coreUrl: string;
  debugUrl: string;
  tempDir: string;
};

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  return { response, json };
}

async function postRaw(url: string, body: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  return { response, json, text };
}

async function optionsRequest(url: string, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "OPTIONS",
    headers,
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : {};
  return { response, json, text };
}

function writePng(
  filePath: string,
  width: number,
  height: number,
  fillPixel: (x: number, y: number) => [number, number, number, number],
): void {
  const png = new PNG({ width, height });

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) * 4;
      const [r, g, b, a] = fillPixel(x, y);
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }

  fs.writeFileSync(filePath, PNG.sync.write(png));
}

describe("AgentRuntime APIs", () => {
  const ctx = {} as RuntimeContext;

  beforeAll(async () => {
    ctx.tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "browser-debug-plugin-"));

    fs.mkdirSync(path.join(ctx.tempDir, "config"), { recursive: true });
    fs.writeFileSync(
      path.join(ctx.tempDir, "config", "domains.json"),
      JSON.stringify({ allowedDomains: ["localhost"], allowHttpLocalhost: true }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(ctx.tempDir, "config", "network-allowlist.json"),
      JSON.stringify({
        captureBodies: [
          {
            method: "POST",
            urlPattern: "https://api.dev.example.com/v1/*",
            maxBytes: 32768,
            captureRequestBody: true,
            captureResponseBody: false,
          },
        ],
      }),
      "utf8",
    );

    ctx.runtime = new AgentRuntime({
      host: "127.0.0.1",
      corePort: 0,
      debugPort: 0,
      rootDir: ctx.tempDir,
      logsDir: path.join(ctx.tempDir, "logs", "browser-debug"),
      retentionDays: 7,
    });

    await ctx.runtime.start();
    ctx.coreUrl = ctx.runtime.getCoreUrl();
    ctx.debugUrl = ctx.runtime.getDebugUrl();
  });

  afterAll(async () => {
    await ctx.runtime.stop();
    fs.rmSync(ctx.tempDir, { force: true, recursive: true });
  });

  it("exposes runtime config and enriched health payload", async () => {
    const healthResponse = await fetch(`${ctx.coreUrl}/health`);
    const health = (await healthResponse.json()) as {
      status: string;
      corePort: number;
      debugPort: number;
      activeProjectId: string;
      appUrl: string;
      appUrlDrift: {
        status: string;
        matchType: string;
        configAppUrl: string;
        activeSessionTabUrl: string | null;
      };
      readiness: {
        debug: boolean;
        query: boolean;
        cdp: boolean;
        cdpReason: string | null;
        cdpPort: number;
      };
      runReadiness: {
        status: string;
        modeHint: string;
        reasons: string[];
        summary: string;
        nextAction: null | {
          label: string;
          hint: string;
          command: string | null;
        };
      };
    };

    expect(healthResponse.status).toBe(200);
    expect(health.status).toBe("ok");
    expect(health.corePort).toBeGreaterThan(0);
    expect(health.debugPort).toBeGreaterThan(0);
    expect(health.activeProjectId).toBe("default-project");
    expect(health.appUrlDrift.status).toBe("no-active-session");
    expect(health.appUrlDrift.matchType).toBe("not-evaluated");
    expect(health.appUrlDrift.configAppUrl).toBe(health.appUrl);
    expect(health.appUrlDrift.activeSessionTabUrl).toBeNull();
    expect(health.readiness.debug).toBe(true);
    expect(health.readiness.query).toBe(true);
    expect(typeof health.readiness.cdp).toBe("boolean");
    expect(typeof health.readiness.cdpPort).toBe("number");
    expect(["runnable", "fallback", "blocked"]).toContain(health.runReadiness.status);
    expect(["core", "terminal-probe"]).toContain(health.runReadiness.modeHint);
    expect(Array.isArray(health.runReadiness.reasons)).toBe(true);
    expect(typeof health.runReadiness.summary).toBe("string");

    const configResponse = await fetch(`${ctx.coreUrl}/runtime/config`);
    const runtimeConfig = (await configResponse.json()) as {
      projectId: string;
      browser: { cdpPort: number };
      capture: { allowedDomains: string[]; networkAllowlist: unknown[] };
    };

    expect(configResponse.status).toBe(200);
    expect(runtimeConfig.projectId).toBe("default-project");
    expect(runtimeConfig.browser.cdpPort).toBe(9222);
    expect(runtimeConfig.capture.allowedDomains).toContain("localhost");
    expect(runtimeConfig.capture.networkAllowlist.length).toBe(1);
  });

  it("updates runtime config and applies dynamic /debug allowlist", async () => {
    const update = {
      version: 1,
      projectId: "project-alpha",
      appUrl: "http://allowed.local:3000",
      agent: {
        host: "127.0.0.1",
        corePort: 4678,
        debugPort: 7331,
      },
      browser: {
        cdpPort: 65534,
      },
      capture: {
        allowedDomains: ["allowed.local"],
        networkAllowlist: [],
      },
      defaults: {
        queryWindowMinutes: 30,
      },
    };

    const { response } = await postJson(`${ctx.coreUrl}/runtime/config`, update);
    expect(response.status).toBe(200);

    const { response: allowedPreflight } = await optionsRequest(`${ctx.debugUrl}/debug`, {
      Origin: "http://allowed.local",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    });

    expect(allowedPreflight.status).toBe(204);
    expect(allowedPreflight.headers.get("access-control-allow-origin")).toBe("http://allowed.local");
    expect(allowedPreflight.headers.get("access-control-allow-methods")).toBe("POST,OPTIONS");
    expect(allowedPreflight.headers.get("access-control-allow-headers")).toBe("content-type");

    const { response: blockedPreflight, json: blockedPreflightBody } = await optionsRequest(`${ctx.debugUrl}/debug`, {
      Origin: "http://evil.local",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    });

    expect(blockedPreflight.status).toBe(403);
    expect(blockedPreflightBody.error.code).toBe("CORS_POLICY_BLOCKED_PATH");
    expect(blockedPreflightBody.error.details.path).toBe("/debug");

    const { response: allowedResponse } = await postJson(
      `${ctx.debugUrl}/debug`,
      {
        marker: "BUGFIX_TRACE",
        tag: "checkout-submit",
        event: "before-submit",
        data: {},
      },
      {
        Origin: "http://allowed.local",
      },
    );
    expect(allowedResponse.status).toBe(202);

    const { response: blockedResponse, json: blockedBody } = await postJson(
      `${ctx.debugUrl}/debug`,
      {
        marker: "BUGFIX_TRACE",
        tag: "checkout-submit",
        event: "before-submit",
        data: {},
      },
      {
        Origin: "http://evil.local",
      },
    );

    expect(blockedResponse.status).toBe(403);
    expect(blockedBody.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("reports health readiness with deep CDP probe state", async () => {
    const healthResponse = await fetch(`${ctx.coreUrl}/health`);
    const health = (await healthResponse.json()) as {
      readiness: {
        debug: boolean;
        query: boolean;
        cdp: boolean;
        cdpReason: string | null;
        cdpPort: number;
      };
      runReadiness: {
        status: string;
        modeHint: string;
        reasons: string[];
      };
    };

    expect(healthResponse.status).toBe(200);
    expect(health.readiness.debug).toBe(true);
    expect(health.readiness.query).toBe(true);
    expect(health.readiness.cdp).toBe(false);
    expect(health.readiness.cdpPort).toBe(65534);
    expect(typeof health.readiness.cdpReason).toBe("string");
    expect(health.runReadiness.status).toBe("fallback");
    expect(health.runReadiness.modeHint).toBe("terminal-probe");
    expect(health.runReadiness.reasons.some((reason) => reason.startsWith("cdp-unavailable:"))).toBe(true);
  });

  it("accepts valid BUGFIX_TRACE on /debug and stores queryable event", async () => {
    const from = new Date(Date.now() - 60_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();

    const { response } = await postJson(
      `${ctx.debugUrl}/debug`,
      {
        marker: "BUGFIX_TRACE",
        tag: "checkout-submit",
        event: "before-submit",
        traceId: "trace-123",
        data: {
          authorization: "Bearer secret-token",
          cartItems: 2,
        },
      },
      {
        Origin: "http://allowed.local",
      },
    );

    expect(response.status).toBe(202);

    const queryResponse = await fetch(
      `${ctx.coreUrl}/events/query?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&tag=checkout-submit`,
    );
    const payload = (await queryResponse.json()) as {
      count: number;
      events: Array<Record<string, unknown>>;
    };

    expect(queryResponse.status).toBe(200);
    expect(payload.count).toBeGreaterThan(0);

    const traceEvent = payload.events.find((item) => item.traceId === "trace-123") as {
      source: string;
      redactionApplied: boolean;
      data: { authorization: string };
    };

    expect(traceEvent.source).toBe("bugfix-trace");
    expect(traceEvent.redactionApplied).toBe(true);
    expect(traceEvent.data.authorization).toBe("[REDACTED]");
  });

  it("rejects /debug event with invalid marker", async () => {
    const { response, json } = await postJson(
      `${ctx.debugUrl}/debug`,
      {
        marker: "INVALID",
        tag: "checkout-submit",
        event: "before-submit",
        data: {},
      },
      {
        Origin: "http://allowed.local",
      },
    );

    expect(response.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("accepts text/plain JSON payload and rejects invalid text/plain JSON", async () => {
    const validPayload = JSON.stringify({
      marker: "BUGFIX_TRACE",
      tag: "checkout-submit",
      event: "plain-text-payload",
      traceId: "trace-text-plain",
      data: {
        from: "text/plain",
      },
    });

    const { response: acceptedResponse } = await postRaw(`${ctx.debugUrl}/debug`, validPayload, {
      "Content-Type": "text/plain",
      Origin: "http://allowed.local",
    });

    expect(acceptedResponse.status).toBe(202);

    const { response: invalidResponse, json: invalidBody } = await postRaw(`${ctx.debugUrl}/debug`, "not-json", {
      "Content-Type": "text/plain",
      Origin: "http://allowed.local",
    });

    expect(invalidResponse.status).toBe(422);
    expect(invalidBody.error.code).toBe("VALIDATION_ERROR");
    expect(invalidBody.error.message).toBe("Invalid text/plain JSON payload");
  });

  it("requires ingest token for /events", async () => {
    const { response, json } = await postJson(`${ctx.coreUrl}/events`, {
      sessionId: "session-x",
      events: [
        {
          eventType: "console",
          message: "hello",
        },
      ],
    });

    expect(response.status).toBe(401);
    expect(json.error.code).toBe("INVALID_INGEST_TOKEN");
  });

  it("rejects session start outside runtime allowlist", async () => {
    const { response, json } = await postJson(`${ctx.coreUrl}/session/start`, {
      tabUrl: "http://evil.local/page",
      debugPort: 9222,
    });

    expect(response.status).toBe(403);
    expect(json.error.code).toBe("DOMAIN_NOT_ALLOWED");
  });

  it("rejects session ensure outside runtime allowlist", async () => {
    const { response, json } = await postJson(`${ctx.coreUrl}/session/ensure`, {
      tabUrl: "http://evil.local/page",
      debugPort: 9222,
      reuseActive: true,
    });

    expect(response.status).toBe(403);
    expect(json.error.code).toBe("DOMAIN_NOT_ALLOWED");
  });

  it("validates matchStrategy on session ensure", async () => {
    const { response, json } = await postJson(`${ctx.coreUrl}/session/ensure`, {
      tabUrl: "http://localhost:3000/page",
      debugPort: 9222,
      reuseActive: true,
      matchStrategy: "bad-strategy",
    });

    expect(response.status).toBe(422);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("runs compare-reference command and writes standardized artifact bundle", async () => {
    const fixturesDir = path.join(ctx.tempDir, "fixtures", "compare-reference");
    fs.mkdirSync(fixturesDir, { recursive: true });

    const actualPath = path.join(fixturesDir, "actual.png");
    const referencePath = path.join(fixturesDir, "reference.png");
    writePng(actualPath, 2, 2, (x, y) => (x === 0 && y === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    writePng(referencePath, 2, 2, () => [255, 255, 255, 255]);

    const { response, json } = await postJson(`${ctx.coreUrl}/command`, {
      sessionId: "compare-reference-session",
      command: "compare-reference",
      payload: {
        actualImagePath: actualPath,
        referenceImagePath: referencePath,
        label: "parity-check",
        writeDiff: true,
      },
    });

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result.runId).toBeTruthy();
    expect(json.result.metrics.diffPixels).toBe(1);
    expect(json.result.metrics.totalPixels).toBe(4);
    expect(json.result.metrics.percentDiffPixels).toBe(25);
    expect(json.result.metrics.resizeApplied).toBe(false);
    expect(json.result.metrics.originalReferenceWidth).toBe(2);
    expect(json.result.metrics.originalReferenceHeight).toBe(2);

    const runtimeJsonPath = String(json.result.artifacts.runtimeJsonPath);
    const metricsJsonPath = String(json.result.artifacts.metricsJsonPath);
    const summaryJsonPath = String(json.result.artifacts.summaryJsonPath);
    const actualArtifactPath = String(json.result.artifacts.actualImagePath);
    const referenceArtifactPath = String(json.result.artifacts.referenceImagePath);
    const diffArtifactPath = String(json.result.artifacts.diffImagePath);

    expect(fs.existsSync(runtimeJsonPath)).toBe(true);
    expect(fs.existsSync(metricsJsonPath)).toBe(true);
    expect(fs.existsSync(summaryJsonPath)).toBe(true);
    expect(fs.existsSync(actualArtifactPath)).toBe(true);
    expect(fs.existsSync(referenceArtifactPath)).toBe(true);
    expect(fs.existsSync(diffArtifactPath)).toBe(true);

    const metricsPayload = JSON.parse(fs.readFileSync(metricsJsonPath, "utf8")) as {
      width: number;
      height: number;
      diffPixels: number;
      resizeApplied: boolean;
      originalReferenceWidth: number;
      originalReferenceHeight: number;
    };
    expect(metricsPayload.width).toBe(2);
    expect(metricsPayload.height).toBe(2);
    expect(metricsPayload.diffPixels).toBe(1);
    expect(metricsPayload.resizeApplied).toBe(false);
    expect(metricsPayload.originalReferenceWidth).toBe(2);
    expect(metricsPayload.originalReferenceHeight).toBe(2);
  });

  it("supports compare-reference resize policy for dimension mismatches", async () => {
    const fixturesDir = path.join(ctx.tempDir, "fixtures", "compare-reference-resize");
    fs.mkdirSync(fixturesDir, { recursive: true });

    const actualPath = path.join(fixturesDir, "actual.png");
    const referencePath = path.join(fixturesDir, "reference-small.png");
    writePng(actualPath, 2, 2, () => [255, 255, 255, 255]);
    writePng(referencePath, 1, 1, () => [255, 255, 255, 255]);

    const { response, json } = await postJson(`${ctx.coreUrl}/command`, {
      sessionId: "compare-reference-session",
      command: "compare-reference",
      payload: {
        actualImagePath: actualPath,
        referenceImagePath: referencePath,
        dimensionPolicy: "resize-reference-to-actual",
        resizeInterpolation: "nearest",
      },
    });

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result.metrics.resizeApplied).toBe(true);
    expect(json.result.metrics.originalReferenceWidth).toBe(1);
    expect(json.result.metrics.originalReferenceHeight).toBe(1);
  });

  it("runs compare-reference command without explicit sessionId", async () => {
    const fixturesDir = path.join(ctx.tempDir, "fixtures", "compare-reference-no-session");
    fs.mkdirSync(fixturesDir, { recursive: true });

    const actualPath = path.join(fixturesDir, "actual.png");
    const referencePath = path.join(fixturesDir, "reference.png");
    writePng(actualPath, 2, 2, () => [255, 255, 255, 255]);
    writePng(referencePath, 2, 2, () => [255, 255, 255, 255]);

    const { response, json } = await postJson(`${ctx.coreUrl}/command`, {
      command: "compare-reference",
      payload: {
        actualImagePath: actualPath,
        referenceImagePath: referencePath,
        label: "no-session-id",
        writeDiff: true,
      },
    });

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.result.metrics.diffPixels).toBe(0);
  });

  it("returns detailed compare-reference errors for missing file, invalid format, and dimension mismatch", async () => {
    const fixturesDir = path.join(ctx.tempDir, "fixtures", "compare-reference-errors");
    fs.mkdirSync(fixturesDir, { recursive: true });

    const existingPngPath = path.join(fixturesDir, "existing.png");
    writePng(existingPngPath, 2, 2, () => [255, 255, 255, 255]);

    const { response: missingResponse, json: missingJson } = await postJson(`${ctx.coreUrl}/command`, {
      sessionId: "compare-reference-session",
      command: "compare-reference",
      payload: {
        actualImagePath: path.join(fixturesDir, "missing.png"),
        referenceImagePath: existingPngPath,
      },
    });
    expect(missingResponse.status).toBe(404);
    expect(missingJson.error.code).toBe("FILE_NOT_FOUND");

    const unsupportedPath = path.join(fixturesDir, "unsupported.txt");
    fs.writeFileSync(unsupportedPath, "plain-text");
    const { response: unsupportedResponse, json: unsupportedJson } = await postJson(`${ctx.coreUrl}/command`, {
      sessionId: "compare-reference-session",
      command: "compare-reference",
      payload: {
        actualImagePath: unsupportedPath,
        referenceImagePath: existingPngPath,
      },
    });
    expect(unsupportedResponse.status).toBe(422);
    expect(unsupportedJson.error.code).toBe("UNSUPPORTED_IMAGE_FORMAT");

    const smallPngPath = path.join(fixturesDir, "small.png");
    writePng(smallPngPath, 1, 1, () => [255, 255, 255, 255]);
    const { response: mismatchResponse, json: mismatchJson } = await postJson(`${ctx.coreUrl}/command`, {
      sessionId: "compare-reference-session",
      command: "compare-reference",
      payload: {
        actualImagePath: smallPngPath,
        referenceImagePath: existingPngPath,
      },
    });
    expect(mismatchResponse.status).toBe(422);
    expect(mismatchJson.error.code).toBe("IMAGE_DIMENSION_MISMATCH");
  });

  it("returns SESSION_NOT_FOUND with nextAction for command without session context", async () => {
    const { response, json } = await postJson(`${ctx.coreUrl}/command`, {
      command: "reload",
      payload: {
        waitUntil: "load",
        timeoutMs: 5000,
      },
    });

    expect(response.status).toBe(404);
    expect(json.error.code).toBe("SESSION_NOT_FOUND");
    expect(json.error.nextAction).toBe("ensure-session");
    expect(json.error.details.activeSessionId).toBeNull();
  });

  it("returns SESSION_NOT_FOUND for webgl-diagnostics when no active session exists", async () => {
    const { response, json } = await postJson(`${ctx.coreUrl}/command`, {
      sessionId: "webgl-diagnostics-session",
      command: "webgl-diagnostics",
      payload: {
        timeoutMs: 5000,
      },
    });

    expect(response.status).toBe(404);
    expect(json.error.code).toBe("SESSION_NOT_FOUND");
  });

  it("retries reload once after stale CDP channel recovery", async () => {
    const runtimeAny = ctx.runtime as unknown as {
      sessionManager: {
        getActive(): { sessionId: string } | null;
        startStarting(tabUrl: string, debugPort: number): { sessionId: string };
        markRunning(attachedTargetUrl: string): { sessionId: string };
        stop(sessionId: string): unknown;
      };
      cdpController: {
        hasConnection(): boolean;
        detach(): Promise<void>;
        attach(options: { tabUrlPattern: string; debugPort: number; matchStrategy: string }): Promise<string>;
        reload(timeoutMs: number): Promise<{ ok: true }>;
      };
    };

    const sessionManager = runtimeAny.sessionManager;
    const cdpController = runtimeAny.cdpController;
    const existing = sessionManager.getActive();
    if (existing) {
      sessionManager.stop(existing.sessionId);
    }

    const running = sessionManager.startStarting("http://allowed.local:3000/health", 9222);
    sessionManager.markRunning("http://allowed.local:3000/health");

    const originalHasConnection = cdpController.hasConnection.bind(cdpController);
    const originalDetach = cdpController.detach.bind(cdpController);
    const originalAttach = cdpController.attach.bind(cdpController);
    const originalReload = cdpController.reload.bind(cdpController);

    let connected = true;
    let reloadCalls = 0;
    let detachCalls = 0;
    let attachCalls = 0;
    const attachStrategies: string[] = [];

    cdpController.hasConnection = () => connected;
    cdpController.detach = async () => {
      detachCalls += 1;
      connected = false;
    };
    cdpController.attach = async (options) => {
      attachCalls += 1;
      attachStrategies.push(options.matchStrategy);
      connected = true;
      return "http://allowed.local:3000/health";
    };
    cdpController.reload = async () => {
      reloadCalls += 1;
      if (reloadCalls === 1) {
        connected = false;
        throw new Error("WebSocket is not open: readyState 3 (CLOSED)");
      }
      return { ok: true };
    };

    try {
      const { response, json } = await postJson(`${ctx.coreUrl}/command`, {
        sessionId: running.sessionId,
        command: "reload",
        payload: {
          waitUntil: "load",
          timeoutMs: 5000,
        },
      });

      expect(response.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(reloadCalls).toBe(2);
      expect(detachCalls).toBe(1);
      expect(attachCalls).toBe(1);
      expect(attachStrategies).toEqual(["exact"]);
    } finally {
      cdpController.hasConnection = originalHasConnection;
      cdpController.detach = originalDetach;
      cdpController.attach = originalAttach;
      cdpController.reload = originalReload;
      const activeAfter = sessionManager.getActive();
      if (activeAfter?.sessionId === running.sessionId) {
        sessionManager.stop(running.sessionId);
      }
    }
  });

  it("does not auto-retry evaluate on stale CDP channel", async () => {
    const runtimeAny = ctx.runtime as unknown as {
      sessionManager: {
        getActive(): { sessionId: string } | null;
        startStarting(tabUrl: string, debugPort: number): { sessionId: string };
        markRunning(attachedTargetUrl: string): { sessionId: string };
        stop(sessionId: string): unknown;
      };
      cdpController: {
        hasConnection(): boolean;
        detach(): Promise<void>;
        attach(options: { tabUrlPattern: string; debugPort: number; matchStrategy: string }): Promise<string>;
        evaluate(
          expression: string,
          returnByValue: boolean,
          awaitPromise: boolean,
          timeoutMs: number,
        ): Promise<{ ok: true; value: unknown }>;
      };
    };

    const sessionManager = runtimeAny.sessionManager;
    const cdpController = runtimeAny.cdpController;
    const existing = sessionManager.getActive();
    if (existing) {
      sessionManager.stop(existing.sessionId);
    }

    const running = sessionManager.startStarting("http://allowed.local:3000/health", 9222);
    sessionManager.markRunning("http://allowed.local:3000/health");

    const originalHasConnection = cdpController.hasConnection.bind(cdpController);
    const originalDetach = cdpController.detach.bind(cdpController);
    const originalAttach = cdpController.attach.bind(cdpController);
    const originalEvaluate = cdpController.evaluate.bind(cdpController);

    let connected = true;
    let evaluateCalls = 0;
    let attachCalls = 0;

    cdpController.hasConnection = () => connected;
    cdpController.detach = async () => {
      connected = false;
    };
    cdpController.attach = async () => {
      attachCalls += 1;
      connected = true;
      return "http://allowed.local:3000/health";
    };
    cdpController.evaluate = async () => {
      evaluateCalls += 1;
      connected = false;
      throw new Error("WebSocket is not open: readyState 3 (CLOSED)");
    };

    try {
      const { response, json } = await postJson(`${ctx.coreUrl}/command`, {
        sessionId: running.sessionId,
        command: "evaluate",
        payload: {
          expression: "window.location.href",
          returnByValue: true,
          awaitPromise: true,
          timeoutMs: 5000,
        },
      });

      expect(response.status).toBe(503);
      expect(json.error.code).toBe("CDP_UNAVAILABLE");
      expect(evaluateCalls).toBe(1);
      expect(attachCalls).toBe(0);
    } finally {
      cdpController.hasConnection = originalHasConnection;
      cdpController.detach = originalDetach;
      cdpController.attach = originalAttach;
      cdpController.evaluate = originalEvaluate;
      const activeAfter = sessionManager.getActive();
      if (activeAfter?.sessionId === running.sessionId) {
        sessionManager.stop(running.sessionId);
      }
    }
  });
});

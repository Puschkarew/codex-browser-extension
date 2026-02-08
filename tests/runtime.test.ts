import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
      readiness: {
        debug: boolean;
        query: boolean;
        cdp: boolean;
        cdpReason: string | null;
        cdpPort: number;
      };
    };

    expect(healthResponse.status).toBe(200);
    expect(health.status).toBe("ok");
    expect(health.corePort).toBeGreaterThan(0);
    expect(health.debugPort).toBeGreaterThan(0);
    expect(health.activeProjectId).toBe("default-project");
    expect(health.readiness.debug).toBe(true);
    expect(health.readiness.query).toBe(true);
    expect(typeof health.readiness.cdp).toBe("boolean");
    expect(typeof health.readiness.cdpPort).toBe("number");

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
    };

    expect(healthResponse.status).toBe(200);
    expect(health.readiness.debug).toBe(true);
    expect(health.readiness.query).toBe(true);
    expect(health.readiness.cdp).toBe(false);
    expect(health.readiness.cdpPort).toBe(65534);
    expect(typeof health.readiness.cdpReason).toBe("string");
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
});

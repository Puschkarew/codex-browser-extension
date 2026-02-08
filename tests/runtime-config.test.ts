import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeConfigState } from "../src/agent/runtime-config.js";

const tempDirs: string[] = [];

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-config-state-"));
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("RuntimeConfigState", () => {
  it("builds default config from fallback files", () => {
    const root = createTempRoot();
    fs.writeFileSync(
      path.join(root, "config", "domains.json"),
      JSON.stringify({ allowedDomains: ["*.dev.example.com"], allowHttpLocalhost: true }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "config", "network-allowlist.json"),
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

    const state = new RuntimeConfigState({
      rootDir: root,
      host: "127.0.0.1",
      corePort: 4678,
      debugPort: 7331,
    });

    const config = state.get();
    expect(config.projectId).toBe("default-project");
    expect(config.capture.allowedDomains).toContain("localhost");
    expect(config.capture.allowedDomains).toContain("127.0.0.1");
    expect(config.capture.allowedDomains).toContain("*.dev.example.com");
    expect(config.capture.networkAllowlist).toHaveLength(1);
  });

  it("keeps runtime ports authoritative and enriches allowed domains by app hostname", () => {
    const root = createTempRoot();

    const state = new RuntimeConfigState({
      rootDir: root,
      host: "127.0.0.1",
      corePort: 4678,
      debugPort: 7331,
    });

    const updated = state.set({
      version: 1,
      projectId: "project-b",
      appUrl: "http://app.local:3000",
      agent: {
        host: "127.0.0.1",
        corePort: 5555,
        debugPort: 6666,
      },
      browser: {
        cdpPort: 9333,
      },
      capture: {
        allowedDomains: ["localhost"],
        networkAllowlist: [],
      },
      defaults: {
        queryWindowMinutes: 30,
      },
    });

    expect(updated.agent.corePort).toBe(4678);
    expect(updated.agent.debugPort).toBe(7331);
    expect(updated.capture.allowedDomains).toContain("app.local");
  });

  it("normalizes loopback allowlist pair for localhost and 127.0.0.1 appUrl", () => {
    const root = createTempRoot();

    const state = new RuntimeConfigState({
      rootDir: root,
      host: "127.0.0.1",
      corePort: 4678,
      debugPort: 7331,
    });

    const updatedLocalhost = state.set({
      version: 1,
      projectId: "project-localhost",
      appUrl: "http://localhost:5173",
      agent: {
        host: "127.0.0.1",
        corePort: 1111,
        debugPort: 2222,
      },
      browser: {
        cdpPort: 9333,
      },
      capture: {
        allowedDomains: ["localhost"],
        networkAllowlist: [],
      },
      defaults: {
        queryWindowMinutes: 30,
      },
    });

    expect(updatedLocalhost.capture.allowedDomains).toContain("localhost");
    expect(updatedLocalhost.capture.allowedDomains).toContain("127.0.0.1");

    const updatedLoopbackIp = state.set({
      version: 1,
      projectId: "project-loopback-ip",
      appUrl: "http://127.0.0.1:5173",
      agent: {
        host: "127.0.0.1",
        corePort: 1111,
        debugPort: 2222,
      },
      browser: {
        cdpPort: 9333,
      },
      capture: {
        allowedDomains: ["127.0.0.1"],
        networkAllowlist: [],
      },
      defaults: {
        queryWindowMinutes: 30,
      },
    });

    expect(updatedLoopbackIp.capture.allowedDomains).toContain("localhost");
    expect(updatedLoopbackIp.capture.allowedDomains).toContain("127.0.0.1");
  });
});

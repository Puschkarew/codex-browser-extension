import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runParityBundle } from "../src/cli/parity-bundle-core.js";

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("runParityBundle", () => {
  it("captures snapshot, compares reference, and writes notes.md", async () => {
    const artifactDir = createTempDir("parity-bundle-artifacts-");
    const calls: Array<Record<string, unknown>> = [];

    const requester = async <T>(url: string, init?: RequestInit): Promise<T> => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      if (body.command === "snapshot") {
        return { ok: true, result: { path: "/tmp/headed-snapshot.png" } } as T;
      }

      return {
        ok: true,
        result: {
          runId: "run-123",
          artifactDir,
          metrics: {
            maeRgb: 0.12,
          },
          artifacts: {
            runtimeJsonPath: path.join(artifactDir, "runtime.json"),
            metricsJsonPath: path.join(artifactDir, "metrics.json"),
            summaryJsonPath: path.join(artifactDir, "summary.json"),
            actualImagePath: path.join(artifactDir, "actual.png"),
            referenceImagePath: path.join(artifactDir, "reference.png"),
            diffImagePath: path.join(artifactDir, "diff.png"),
          },
        },
      } as T;
    };

    const result = await runParityBundle(
      {
        coreBaseUrl: "http://127.0.0.1:4678",
        sessionId: "session-1",
        referenceImagePath: "/tmp/reference.png",
        label: "baseline",
      },
      requester,
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]?.body).toMatchObject({
      sessionId: "session-1",
      command: "snapshot",
    });
    expect(calls[1]?.body).toMatchObject({
      sessionId: "session-1",
      command: "compare-reference",
    });

    expect(result.artifactDir).toBe(artifactDir);
    expect(result.notesPath).toBe(path.join(artifactDir, "notes.md"));
    expect(fs.existsSync(result.notesPath)).toBe(true);
    const notes = fs.readFileSync(result.notesPath, "utf8");
    expect(notes).toContain("# Visual Parity Bundle");
    expect(notes).toContain("maeRgb");
    expect(notes).toContain("artifactDir");
  });

  it("uses provided actual image and copies optional headless image", async () => {
    const artifactDir = createTempDir("parity-bundle-artifacts-");
    const headlessSource = path.join(createTempDir("parity-bundle-headless-"), "headless-input.png");
    fs.writeFileSync(headlessSource, "fake-image", "utf8");

    const calls: Array<Record<string, unknown>> = [];
    const requester = async <T>(url: string, init?: RequestInit): Promise<T> => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url, body });
      return {
        ok: true,
        result: {
          runId: "run-456",
          artifactDir,
          metrics: {},
          artifacts: {
            runtimeJsonPath: path.join(artifactDir, "runtime.json"),
            metricsJsonPath: path.join(artifactDir, "metrics.json"),
            summaryJsonPath: path.join(artifactDir, "summary.json"),
            actualImagePath: path.join(artifactDir, "actual.png"),
            referenceImagePath: path.join(artifactDir, "reference.png"),
            diffImagePath: null,
          },
        },
      } as T;
    };

    const result = await runParityBundle(
      {
        coreBaseUrl: "http://127.0.0.1:4678",
        referenceImagePath: "/tmp/reference.png",
        actualImagePath: "/tmp/actual.png",
        headlessImagePath: headlessSource,
      },
      requester,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      command: "compare-reference",
    });
    expect(result.headlessImagePath).toBe(path.join(artifactDir, "headless.png"));
    expect(fs.existsSync(path.join(artifactDir, "headless.png"))).toBe(true);
  });

  it("throws when compare-reference payload is missing run identifiers", async () => {
    const requester = async <T>(): Promise<T> => {
      return {
        ok: true,
        result: {
          artifacts: {},
        },
      } as T;
    };

    await expect(
      runParityBundle(
        {
          coreBaseUrl: "http://127.0.0.1:4678",
          referenceImagePath: "/tmp/reference.png",
          actualImagePath: "/tmp/actual.png",
        },
        requester,
      ),
    ).rejects.toThrow("missing artifactDir/runId");
  });
});

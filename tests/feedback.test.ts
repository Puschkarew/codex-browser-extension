import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

function writeSessionFile(
  filePath: string,
  messageText: string,
  options?: {
    sessionId?: string;
    cwd?: string;
    timestamp?: string;
  },
): void {
  writeSessionFileWithMessages(filePath, [messageText], options);
}

function writeSessionFileWithMessages(
  filePath: string,
  messageTexts: string[],
  options?: {
    sessionId?: string;
    cwd?: string;
    timestamp?: string;
  },
): void {
  const sessionId = options?.sessionId ?? "session-1";
  const cwd = options?.cwd ?? "/tmp/workspace";
  const timestamp = options?.timestamp ?? "2026-02-17T12:00:00.000Z";
  const lines: string[] = [
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: sessionId,
        cwd,
      },
    }),
  ];
  for (const messageText of messageTexts) {
    lines.push(
      JSON.stringify({
        timestamp,
        type: "response_item",
        payload: {
          role: "assistant",
          type: "message",
          content: [{ text: messageText }],
        },
      }),
    );
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

describe("agent:feedback", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not count issues for messages outside target scope", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    tempDirs.push(codexHome);

    const sessionDir = path.join(codexHome, "sessions", "2026", "02", "17");
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, "session.jsonl");
    writeSessionFile(
      sessionFile,
      "canInstrumentFromBrowser=false and terminal-probe fallback because appUrl mismatch",
    );

    const { stdout } = await execFileAsync(
      path.join(process.cwd(), "node_modules", ".bin", "tsx"),
      ["src/cli/feedback.ts", "--window", "24h", "--targets", "nonexistent-target", "--json"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
        },
      },
    );

    const payload = JSON.parse(stdout) as {
      schemaVersion: string;
      promotionRules: {
        probableSignalPolicy: {
          minDistinctSessionsForBacklog: number;
        };
      };
      relevantSessions: number;
      issues: Array<{ id: string }>;
      signals: Array<{ signalId: string }>;
      backlogSlice: Array<{ issueId: string }>;
    };

    expect(payload.schemaVersion).toBe("2026-02-18-feedback-signals-v1");
    expect(payload.promotionRules.probableSignalPolicy.minDistinctSessionsForBacklog).toBe(2);
    expect(payload.relevantSessions).toBe(0);
    expect(payload.issues).toEqual([]);
    expect(payload.signals).toEqual([]);
    expect(payload.backlogSlice).toEqual([]);
  });

  it("emits structured signals with confidence and priority hints", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    tempDirs.push(codexHome);

    const sessionDir = path.join(codexHome, "sessions", "2026", "02", "18");
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, "session.jsonl");
    writeSessionFile(
      sessionFile,
      "fix-app-bugs report: canInstrumentFromBrowser=false and terminal-probe due appUrl mismatch",
    );

    const { stdout } = await execFileAsync(
      path.join(process.cwd(), "node_modules", ".bin", "tsx"),
      ["src/cli/feedback.ts", "--window", "24h", "--targets", "fix-app-bugs", "--json"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
        },
      },
    );

    const payload = JSON.parse(stdout) as {
      signals: Array<{
        issueId: string;
        area: string;
        signalType: string;
        confidence: string;
        priorityHint: string;
        promotion: {
          status: string;
          probable: boolean;
          observedDistinctSessions: number;
        };
        evidenceRefs: Array<{ filePath: string }>;
      }>;
      backlogSlice: Array<{ issueId: string }>;
    };

    expect(payload.signals.length).toBeGreaterThan(0);
    expect(payload.signals[0].issueId).toBe("appurl_mismatch_terminal_probe");
    expect(payload.signals[0].area).toBe("shared");
    expect(payload.signals[0].signalType).toBe("explicit");
    expect(["high", "medium", "low"]).toContain(payload.signals[0].confidence);
    expect(["p0", "p1", "p2"]).toContain(payload.signals[0].priorityHint);
    expect(payload.signals[0].promotion.status).toBe("promoted");
    expect(payload.signals[0].promotion.probable).toBe(false);
    expect(payload.signals[0].evidenceRefs[0].filePath).toContain("session.jsonl");
    expect(payload.backlogSlice[0].issueId).toBe("appurl_mismatch_terminal_probe");
  });

  it("defers probable inferred signals until repeated across independent sessions", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    tempDirs.push(codexHome);

    const sessionDir = path.join(codexHome, "sessions", "2026", "02", "19");
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionFile = path.join(sessionDir, "session-1.jsonl");
    writeSessionFile(
      sessionFile,
      "fix-app-bugs iterative flow keeps running cleanup_guarded --strict before each retry",
      { sessionId: "session-1" },
    );

    const { stdout } = await execFileAsync(
      path.join(process.cwd(), "node_modules", ".bin", "tsx"),
      ["src/cli/feedback.ts", "--window", "24h", "--targets", "fix-app-bugs", "--json"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
        },
      },
    );

    const payload = JSON.parse(stdout) as {
      signals: Array<{
        issueId: string;
        promotion: { status: string; probable: boolean; observedDistinctSessions: number };
      }>;
      backlogSlice: Array<{ issueId: string }>;
    };

    const inferredSignal = payload.signals.find((signal) => signal.issueId === "cleanup_strict_iteration_cost");
    expect(inferredSignal).toBeTruthy();
    expect(inferredSignal?.promotion.status).toBe("deferred");
    expect(inferredSignal?.promotion.probable).toBe(true);
    expect(inferredSignal?.promotion.observedDistinctSessions).toBe(1);
    expect(payload.backlogSlice.some((signal) => signal.issueId === "cleanup_strict_iteration_cost")).toBe(false);
  });

  it("promotes probable inferred signals when repeated across distinct sessions", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    tempDirs.push(codexHome);

    const sessionDir = path.join(codexHome, "sessions", "2026", "02", "19");
    fs.mkdirSync(sessionDir, { recursive: true });
    writeSessionFile(
      path.join(sessionDir, "session-a.jsonl"),
      "fix-app-bugs iterative flow keeps running cleanup_guarded --strict before each retry",
      { sessionId: "session-a" },
    );
    writeSessionFile(
      path.join(sessionDir, "session-b.jsonl"),
      "fix-app-bugs iterative flow keeps running cleanup_guarded --strict before each retry",
      { sessionId: "session-b" },
    );

    const { stdout } = await execFileAsync(
      path.join(process.cwd(), "node_modules", ".bin", "tsx"),
      ["src/cli/feedback.ts", "--window", "24h", "--targets", "fix-app-bugs", "--json"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
        },
      },
    );

    const payload = JSON.parse(stdout) as {
      signals: Array<{
        issueId: string;
        promotion: { status: string; probable: boolean; observedDistinctSessions: number };
      }>;
      backlogSlice: Array<{ issueId: string }>;
    };

    const inferredSignal = payload.signals.find((signal) => signal.issueId === "cleanup_strict_iteration_cost");
    expect(inferredSignal).toBeTruthy();
    expect(inferredSignal?.promotion.status).toBe("promoted");
    expect(inferredSignal?.promotion.probable).toBe(true);
    expect(inferredSignal?.promotion.observedDistinctSessions).toBe(2);
    expect(payload.backlogSlice.some((signal) => signal.issueId === "cleanup_strict_iteration_cost")).toBe(true);
  });

  it("uses distinct-session recurrence for promotion even when evidence samples are capped", async () => {
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
    tempDirs.push(codexHome);

    const sessionDir = path.join(codexHome, "sessions", "2026", "02", "19");
    fs.mkdirSync(sessionDir, { recursive: true });
    const message = "fix-app-bugs iterative flow keeps running cleanup_guarded --strict before each retry";

    writeSessionFileWithMessages(path.join(sessionDir, "session-a.jsonl"), [message, message, message], {
      sessionId: "session-a",
    });
    writeSessionFile(path.join(sessionDir, "session-b.jsonl"), message, { sessionId: "session-b" });

    const { stdout } = await execFileAsync(
      path.join(process.cwd(), "node_modules", ".bin", "tsx"),
      ["src/cli/feedback.ts", "--window", "24h", "--targets", "fix-app-bugs", "--json"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CODEX_HOME: codexHome,
        },
      },
    );

    const payload = JSON.parse(stdout) as {
      signals: Array<{
        issueId: string;
        promotion: { status: string; probable: boolean; observedDistinctSessions: number };
        evidenceRefs: Array<{ sessionId: string | null }>;
      }>;
      backlogSlice: Array<{ issueId: string }>;
    };

    const inferredSignal = payload.signals.find((signal) => signal.issueId === "cleanup_strict_iteration_cost");
    expect(inferredSignal).toBeTruthy();
    expect(inferredSignal?.promotion.status).toBe("promoted");
    expect(inferredSignal?.promotion.probable).toBe(true);
    expect(inferredSignal?.promotion.observedDistinctSessions).toBe(2);
    expect(inferredSignal?.evidenceRefs.length).toBe(3);
    expect(inferredSignal?.evidenceRefs.every((ref) => ref.sessionId === "session-a")).toBe(true);
    expect(payload.backlogSlice.some((signal) => signal.issueId === "cleanup_strict_iteration_cost")).toBe(true);
  });
});

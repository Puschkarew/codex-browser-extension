import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

function writeSessionFile(filePath: string, messageText: string): void {
  const lines = [
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: "session-1",
        cwd: "/tmp/workspace",
      },
    }),
    JSON.stringify({
      timestamp: "2026-02-17T12:00:00.000Z",
      type: "response_item",
      payload: {
        role: "assistant",
        type: "message",
        content: [{ text: messageText }],
      },
    }),
  ];
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
      relevantSessions: number;
      issues: Array<{ id: string }>;
    };

    expect(payload.relevantSessions).toBe(0);
    expect(payload.issues).toEqual([]);
  });
});

import fs from "node:fs";
import path from "node:path";
import { AgentRuntime } from "./runtime.js";

function appendFatalLog(logPath: string, label: string, error: unknown): void {
  const reason = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${label}\n${reason}\n\n`, "utf8");
}

async function main(): Promise<void> {
  const fatalLogPath = process.env.AGENT_FATAL_LOG ?? path.join(process.cwd(), "logs", "browser-debug", "agent-fatal.log");

  const runtime = new AgentRuntime({
    rootDir: process.cwd(),
    logsDir: path.join(process.cwd(), "logs", "browser-debug"),
    corePort: Number(process.env.CORE_PORT ?? 4678),
    debugPort: Number(process.env.DEBUG_PORT ?? 7331),
  });

  let shuttingDown = false;
  const shutdown = async (exitCode: number, label: string, error?: unknown): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    if (error !== undefined) {
      appendFatalLog(fatalLogPath, label, error);
      console.error(`[browser-debug-agent] ${label}:`, error);
    }

    try {
      await runtime.stop();
    } catch (stopError) {
      appendFatalLog(fatalLogPath, "runtime.stop failed", stopError);
    }

    process.exit(exitCode);
  };

  process.on("uncaughtException", (error) => {
    void shutdown(1, "uncaughtException", error);
  });

  process.on("unhandledRejection", (reason) => {
    void shutdown(1, "unhandledRejection", reason);
  });

  await runtime.start();

  process.on("SIGINT", async () => {
    await shutdown(0, "SIGINT");
  });

  process.on("SIGTERM", async () => {
    await shutdown(0, "SIGTERM");
  });
}

void main().catch((error) => {
  const fatalLogPath = process.env.AGENT_FATAL_LOG ?? path.join(process.cwd(), "logs", "browser-debug", "agent-fatal.log");
  appendFatalLog(fatalLogPath, "startup-failure", error);
  console.error("[browser-debug-agent] startup-failure:", error);
  process.exit(1);
});

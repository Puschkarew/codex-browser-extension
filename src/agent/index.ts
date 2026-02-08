import path from "node:path";
import { AgentRuntime } from "./runtime.js";

async function main(): Promise<void> {
  const runtime = new AgentRuntime({
    rootDir: process.cwd(),
    logsDir: path.join(process.cwd(), "logs", "browser-debug"),
    corePort: Number(process.env.CORE_PORT ?? 4678),
    debugPort: Number(process.env.DEBUG_PORT ?? 7331),
  });

  await runtime.start();

  process.on("SIGINT", async () => {
    await runtime.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await runtime.stop();
    process.exit(0);
  });
}

void main();

import fs from "node:fs";
import path from "node:path";
import { QueryRequest, RuntimeEvent } from "../shared/contracts.js";

export type QueryResult = {
  count: number;
  truncated: boolean;
  events: RuntimeEvent[];
};

export class JsonlStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  getRootDir(): string {
    return this.rootDir;
  }

  appendEvent(event: RuntimeEvent): void {
    const filePath = path.join(this.rootDir, `${event.sessionId}.jsonl`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  appendEvents(events: RuntimeEvent[]): void {
    for (const event of events) {
      this.appendEvent(event);
    }
  }

  saveScreenshot(sessionId: string, screenshotBase64: string): string {
    const dir = path.join(this.rootDir, sessionId, "screenshots");
    fs.mkdirSync(dir, { recursive: true });
    const fileName = `${Date.now()}.png`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, Buffer.from(screenshotBase64, "base64"));
    return filePath;
  }

  query(params: QueryRequest): QueryResult {
    const fromTs = new Date(params.from).getTime();
    const toTs = new Date(params.to).getTime();
    const limit = params.limit ?? 500;

    const files = fs
      .readdirSync(this.rootDir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => path.join(this.rootDir, name));

    const matched: RuntimeEvent[] = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").filter(Boolean);

      for (const line of lines) {
        let parsed: RuntimeEvent;
        try {
          parsed = JSON.parse(line) as RuntimeEvent;
        } catch {
          continue;
        }

        const eventTs = new Date(parsed.ts).getTime();
        if (Number.isNaN(eventTs) || eventTs < fromTs || eventTs > toTs) {
          continue;
        }

        if (params.tag && parsed.tag !== params.tag) {
          continue;
        }

        if (params.traceId && parsed.traceId !== params.traceId) {
          continue;
        }

        if (params.sessionId && parsed.sessionId !== params.sessionId) {
          continue;
        }

        if (params.eventType && parsed.eventType !== params.eventType) {
          continue;
        }

        matched.push(parsed);
      }
    }

    matched.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

    const truncated = matched.length > limit;
    const events = truncated ? matched.slice(0, limit) : matched;

    return {
      count: events.length,
      truncated,
      events,
    };
  }

  cleanupOlderThan(days: number): number {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    let deleted = 0;

    const entries = fs.readdirSync(this.rootDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(this.rootDir, entry.name);
      const stat = fs.statSync(fullPath);
      if (stat.mtimeMs >= cutoff) {
        continue;
      }

      fs.rmSync(fullPath, { recursive: true, force: true });
      deleted += 1;
    }

    return deleted;
  }
}

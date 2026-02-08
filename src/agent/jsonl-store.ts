import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { QueryRequest, RuntimeEvent } from "../shared/contracts.js";

export type QueryResult = {
  count: number;
  truncated: boolean;
  events: RuntimeEvent[];
};

export type ArtifactRun = {
  runId: string;
  sessionId: string;
  label: string;
  createdAt: string;
  dir: string;
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

  createArtifactRun(sessionId: string, label = "compare-reference"): ArtifactRun {
    const safeSessionId = this.sanitizePathSegment(sessionId, "manual");
    const safeLabel = this.sanitizePathSegment(label, "artifact");
    const createdAt = new Date().toISOString();
    const tsPart = createdAt.replace(/[:.]/g, "-");
    const suffix = crypto.randomUUID().slice(0, 8);
    const runId = `${tsPart}-${safeLabel}-${suffix}`;
    const dir = path.join(this.rootDir, safeSessionId, "artifacts", runId);
    fs.mkdirSync(dir, { recursive: true });

    return {
      runId,
      sessionId: safeSessionId,
      label: safeLabel,
      createdAt,
      dir,
    };
  }

  writeArtifactJson(run: ArtifactRun, fileName: string, payload: unknown): string {
    const safeFileName = this.sanitizeFileName(fileName);
    const filePath = path.join(run.dir, safeFileName);
    fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return filePath;
  }

  writeArtifactBinary(run: ArtifactRun, fileName: string, data: Buffer): string {
    const safeFileName = this.sanitizeFileName(fileName);
    const filePath = path.join(run.dir, safeFileName);
    fs.writeFileSync(filePath, data);
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

  private sanitizePathSegment(value: string, fallback: string): string {
    const trimmed = value.trim();
    const normalized = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
    return normalized || fallback;
  }

  private sanitizeFileName(value: string): string {
    const base = path.basename(value);
    return this.sanitizePathSegment(base, "artifact");
  }
}

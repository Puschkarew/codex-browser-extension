import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { getArg, hasFlag } from "./args.js";

type IssueDefinition = {
  id: string;
  description: string;
  area: "plugin" | "skill" | "shared";
  signalType: "explicit" | "inferred";
  pattern: RegExp;
};

type IssueSample = {
  sessionId: string | null;
  timestamp: string | null;
  workspace: string | null;
  filePath: string;
  snippet: string;
};

type IssueAggregate = {
  id: string;
  description: string;
  area: "plugin" | "skill" | "shared";
  signalType: "explicit" | "inferred";
  count: number;
  samples: IssueSample[];
};

type SessionSummary = {
  filePath: string;
  sessionId: string | null;
  workspace: string | null;
  relevantHits: number;
  issueHits: number;
};

type FeedbackReport = {
  generatedAt: string;
  windowHours: number;
  windowStartUtc: string;
  windowEndUtc: string;
  targets: string[];
  scannedFiles: number;
  relevantSessions: number;
  workspaceCounts: Array<{ workspace: string; count: number }>;
  sessions: SessionSummary[];
  issues: IssueAggregate[];
};

const NOISE_PATTERNS: RegExp[] = [
  /AGENTS\.md instructions/i,
  /BEGIN COMPOUND CODEX TOOL MAP/i,
  /<skill>/i,
  /<INSTRUCTIONS>/i,
];

const ISSUE_DEFINITIONS: IssueDefinition[] = [
  {
    id: "appurl_mismatch_terminal_probe",
    description: "appUrl mismatch forces terminal-probe fallback",
    area: "shared",
    signalType: "explicit",
    pattern:
      /(canInstrumentFromBrowser\s*=\s*false|terminal-probe[\s\S]{0,120}appUrl|appUrl[\s\S]{0,80}mismatch|mismatch[\s\S]{0,80}appUrl|appUrl=.*localhost:3000)/i,
  },
  {
    id: "plan_mode_manual_config_fix",
    description: "plan-mode requires manual config fix handoff",
    area: "skill",
    signalType: "explicit",
    pattern: /(plan-mode[\s\S]{0,80}(автоправк|auto.?fix))/i,
  },
  {
    id: "cleanup_strict_iteration_cost",
    description: "cleanup_guarded --strict appears in iterative flow",
    area: "skill",
    signalType: "inferred",
    pattern: /cleanup_guarded\s+--strict/i,
  },
  {
    id: "cross_project_feedback_analytics_request",
    description: "explicit request for cross-project 24h analytics",
    area: "shared",
    signalType: "explicit",
    pattern: /(аналитику всех чатов|всех проектов|cross-project[\s-]*analytics|all projects)/i,
  },
];

function parseWindowHours(raw: string | undefined): number {
  if (!raw) {
    return 24;
  }
  const normalized = raw.trim().toLowerCase();
  const hoursMatch = normalized.match(/^(\d+)\s*h$/);
  if (hoursMatch) {
    return Math.max(1, Number(hoursMatch[1]));
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.floor(numeric);
  }
  throw new Error(`Invalid --window value '${raw}'. Use forms like 24h or 24.`);
}

function parseTargets(raw: string | undefined): string[] {
  const value = raw?.trim();
  if (!value) {
    return ["browser-debug", "fix-app-bugs"];
  }
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item, index, list) => item.length > 0 && list.indexOf(item) === index);
}

function toUtcIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

async function walkJsonlFiles(rootDir: string): Promise<string[]> {
  const result: string[] = [];
  const queue: string[] = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) {
      continue;
    }
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (entry.isFile() && fullPath.endsWith(".jsonl")) {
        result.push(fullPath);
      }
    }
  }

  return result;
}

async function collectRecentSessionFiles(windowHours: number): Promise<string[]> {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  const roots = [path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions")];
  const cutoff = Date.now() - windowHours * 60 * 60 * 1000;
  const files: string[] = [];

  for (const root of roots) {
    try {
      const stat = await fs.stat(root);
      if (!stat.isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }

    const candidates = await walkJsonlFiles(root);
    for (const candidate of candidates) {
      try {
        const info = await fs.stat(candidate);
        if (info.mtimeMs >= cutoff) {
          files.push(candidate);
        }
      } catch {
        // skip transient file errors
      }
    }
  }

  return files.sort();
}

function extractMessageText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const maybePayload = payload as Record<string, unknown>;
  if (maybePayload.type !== "message") {
    return null;
  }

  const content = maybePayload.content;
  if (!Array.isArray(content)) {
    return null;
  }

  const chunks: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const text = (item as Record<string, unknown>).text;
    if (typeof text === "string" && text.trim().length > 0) {
      chunks.push(text.trim());
    }
  }

  if (chunks.length === 0) {
    return null;
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}

function looksLikeNoise(text: string): boolean {
  return NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

function buildTargetPattern(targets: string[]): RegExp {
  const escaped = targets.map((target) => target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) {
    return /(browser-debug|fix-app-bugs)/i;
  }
  return new RegExp(escaped.join("|"), "i");
}

function pushIssueSample(aggregate: IssueAggregate, sample: IssueSample): void {
  if (aggregate.samples.length >= 3) {
    return;
  }
  aggregate.samples.push(sample);
}

async function analyzeSessionFile(
  filePath: string,
  targetPattern: RegExp,
  issuesById: Map<string, IssueAggregate>,
): Promise<SessionSummary> {
  let sessionId: string | null = null;
  let workspace: string | null = null;
  let relevantHits = 0;
  let issueHits = 0;

  const reader = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    let record: Record<string, unknown>;
    try {
      record = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = record.type;
    const payload = record.payload;

    if (type === "session_meta" && payload && typeof payload === "object") {
      const payloadObject = payload as Record<string, unknown>;
      if (typeof payloadObject.id === "string" && payloadObject.id.length > 0) {
        sessionId = payloadObject.id;
      }
      if (typeof payloadObject.cwd === "string" && payloadObject.cwd.length > 0) {
        workspace = payloadObject.cwd;
      }
      continue;
    }

    if (type !== "response_item") {
      continue;
    }
    if (!payload || typeof payload !== "object") {
      continue;
    }
    const payloadObject = payload as Record<string, unknown>;
    const role = payloadObject.role;
    if (role !== "assistant" && role !== "user") {
      continue;
    }

    const text = extractMessageText(payloadObject);
    if (!text || looksLikeNoise(text)) {
      continue;
    }

    const targetMatched = targetPattern.test(text);
    if (targetMatched) {
      relevantHits += 1;
    }

    if (!targetMatched) {
      continue;
    }

    for (const issue of ISSUE_DEFINITIONS) {
      if (!issue.pattern.test(text)) {
        continue;
      }
      issueHits += 1;
      const aggregate = issuesById.get(issue.id);
      if (!aggregate) {
        continue;
      }
      aggregate.count += 1;
      pushIssueSample(aggregate, {
        sessionId,
        timestamp: typeof record.timestamp === "string" ? record.timestamp : null,
        workspace,
        filePath,
        snippet: text.slice(0, 220),
      });
    }
  }

  return {
    filePath,
    sessionId,
    workspace,
    relevantHits,
    issueHits,
  };
}

function formatReportAsMarkdown(report: FeedbackReport): string {
  const lines: string[] = [];
  lines.push("# Agent Feedback Summary");
  lines.push("");
  lines.push(`- generatedAt: \`${report.generatedAt}\``);
  lines.push(`- window: last \`${report.windowHours}h\` (\`${report.windowStartUtc}\` .. \`${report.windowEndUtc}\`)`);
  lines.push(`- scannedFiles: \`${report.scannedFiles}\``);
  lines.push(`- relevantSessions: \`${report.relevantSessions}\``);
  lines.push(`- targets: \`${report.targets.join(",")}\``);
  lines.push("");

  lines.push("## Workspace Coverage");
  if (report.workspaceCounts.length === 0) {
    lines.push("- none");
  } else {
    for (const item of report.workspaceCounts) {
      lines.push(`- ${item.count} - \`${item.workspace}\``);
    }
  }
  lines.push("");

  lines.push("## Issue Counts");
  if (report.issues.length === 0) {
    lines.push("- no issues matched configured patterns");
  } else {
    for (const issue of report.issues) {
      lines.push(
        `- \`${issue.id}\` (${issue.area}, ${issue.signalType}): ${issue.count} - ${issue.description}`,
      );
      for (const sample of issue.samples) {
        lines.push(
          `  sample: session=\`${sample.sessionId ?? "unknown"}\` ts=\`${sample.timestamp ?? "unknown"}\` file=\`${sample.filePath}\``,
        );
      }
    }
  }
  lines.push("");

  lines.push("## Session Details");
  for (const session of report.sessions) {
    lines.push(
      `- session=\`${session.sessionId ?? "unknown"}\` relevantHits=\`${session.relevantHits}\` issueHits=\`${session.issueHits}\` workspace=\`${session.workspace ?? "unknown"}\``,
    );
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const windowHours = parseWindowHours(getArg("--window"));
  const targets = parseTargets(getArg("--targets"));
  const targetPattern = buildTargetPattern(targets);
  const windowEndMs = Date.now();
  const windowStartMs = windowEndMs - windowHours * 60 * 60 * 1000;

  const files = await collectRecentSessionFiles(windowHours);
  const issuesById = new Map<string, IssueAggregate>();
  for (const definition of ISSUE_DEFINITIONS) {
    issuesById.set(definition.id, {
      id: definition.id,
      description: definition.description,
      area: definition.area,
      signalType: definition.signalType,
      count: 0,
      samples: [],
    });
  }

  const sessions: SessionSummary[] = [];
  for (const filePath of files) {
    sessions.push(await analyzeSessionFile(filePath, targetPattern, issuesById));
  }

  const relevantSessions = sessions.filter((session) => session.relevantHits > 0 || session.issueHits > 0);
  const workspaceCounts = new Map<string, number>();
  for (const session of relevantSessions) {
    const workspace = session.workspace ?? "unknown";
    workspaceCounts.set(workspace, (workspaceCounts.get(workspace) ?? 0) + 1);
  }

  const report: FeedbackReport = {
    generatedAt: new Date(windowEndMs).toISOString(),
    windowHours,
    windowStartUtc: toUtcIso(windowStartMs),
    windowEndUtc: toUtcIso(windowEndMs),
    targets,
    scannedFiles: files.length,
    relevantSessions: relevantSessions.length,
    workspaceCounts: Array.from(workspaceCounts.entries())
      .map(([workspace, count]) => ({ workspace, count }))
      .sort((a, b) => b.count - a.count || a.workspace.localeCompare(b.workspace)),
    sessions: relevantSessions,
    issues: Array.from(issuesById.values())
      .filter((issue) => issue.count > 0)
      .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
  };

  if (hasFlag("--json")) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatReportAsMarkdown(report));
}

void main();

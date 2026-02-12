import fs from "node:fs";
import path from "node:path";

export type ParityBundleOptions = {
  coreBaseUrl: string;
  referenceImagePath: string;
  sessionId?: string;
  label?: string;
  timeoutMs?: number;
  fullPage?: boolean;
  actualImagePath?: string;
  writeDiff?: boolean;
  headlessImagePath?: string;
};

type CommandResponse = {
  ok: boolean;
  result: Record<string, unknown>;
};

export type JsonRequester = <T>(url: string, init?: RequestInit) => Promise<T>;

type CompareArtifacts = {
  runtimeJsonPath?: string;
  metricsJsonPath?: string;
  summaryJsonPath?: string;
  actualImagePath?: string;
  referenceImagePath?: string;
  diffImagePath?: string | null;
};

type ParityMetrics = Record<string, unknown>;

export type ParityBundleResult = {
  runId: string;
  artifactDir: string;
  notesPath: string;
  sessionId: string | null;
  label: string;
  actualSourcePath: string;
  headedSnapshotPath: string | null;
  headlessImagePath: string | null;
  metrics: ParityMetrics | null;
  artifacts: CompareArtifacts;
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object payload");
  }
  return value as Record<string, unknown>;
}

function ensureCommandResult(response: CommandResponse): Record<string, unknown> {
  if (!response.ok) {
    throw new Error("Core command returned ok=false");
  }
  return ensureObject(response.result);
}

function commandBody(
  command: string,
  payload: Record<string, unknown>,
  sessionId?: string,
): Record<string, unknown> {
  return {
    ...(sessionId ? { sessionId } : {}),
    command,
    payload,
  };
}

async function runCommand(
  requestJson: JsonRequester,
  coreBaseUrl: string,
  command: string,
  payload: Record<string, unknown>,
  sessionId?: string,
): Promise<Record<string, unknown>> {
  const response = await requestJson<CommandResponse>(`${coreBaseUrl}/command`, {
    method: "POST",
    body: JSON.stringify(commandBody(command, payload, sessionId)),
  });
  return ensureCommandResult(response);
}

function copyHeadlessImage(headlessImagePath: string, artifactDir: string): string {
  const extension = path.extname(headlessImagePath) || ".png";
  const outputPath = path.join(artifactDir, `headless${extension}`);
  fs.copyFileSync(headlessImagePath, outputPath);
  return outputPath;
}

export function buildNotesMarkdown(input: {
  generatedAt: string;
  coreBaseUrl: string;
  sessionId: string | null;
  label: string;
  actualSourcePath: string;
  referenceImagePath: string;
  artifactDir: string;
  notesPath: string;
  headedSnapshotPath: string | null;
  headlessImagePath: string | null;
  artifacts: CompareArtifacts;
  metrics: ParityMetrics | null;
}): string {
  const metricEntries = input.metrics ? Object.entries(input.metrics) : [];
  const metricsLines = metricEntries.length
    ? metricEntries.map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)
    : ["- unavailable"];

  return [
    "# Visual Parity Bundle",
    "",
    "## Summary",
    `- generatedAt: ${input.generatedAt}`,
    `- coreBaseUrl: ${input.coreBaseUrl}`,
    `- sessionId: ${input.sessionId ?? "none"}`,
    `- label: ${input.label}`,
    "",
    "## Inputs",
    `- actualSourcePath: ${input.actualSourcePath}`,
    `- referenceImagePath: ${input.referenceImagePath}`,
    `- headedSnapshotPath: ${input.headedSnapshotPath ?? "none"}`,
    `- headlessImagePath: ${input.headlessImagePath ?? "none"}`,
    "",
    "## Artifacts",
    `- artifactDir: ${input.artifactDir}`,
    `- runtimeJsonPath: ${input.artifacts.runtimeJsonPath ?? "n/a"}`,
    `- metricsJsonPath: ${input.artifacts.metricsJsonPath ?? "n/a"}`,
    `- summaryJsonPath: ${input.artifacts.summaryJsonPath ?? "n/a"}`,
    `- actualImagePath: ${input.artifacts.actualImagePath ?? "n/a"}`,
    `- referenceImagePath: ${input.artifacts.referenceImagePath ?? "n/a"}`,
    `- diffImagePath: ${input.artifacts.diffImagePath ?? "n/a"}`,
    `- notesPath: ${input.notesPath}`,
    "",
    "## Metrics",
    ...metricsLines,
    "",
  ].join("\n");
}

export async function runParityBundle(
  options: ParityBundleOptions,
  requestJson: JsonRequester,
): Promise<ParityBundleResult> {
  const referenceImagePath = asString(options.referenceImagePath);
  if (!referenceImagePath) {
    throw new Error("referenceImagePath is required");
  }

  const label = asString(options.label) ?? "parity-bundle";
  const timeoutMs = Number.isFinite(options.timeoutMs) && (options.timeoutMs ?? 0) > 0
    ? Math.floor(options.timeoutMs as number)
    : 20_000;

  let actualSourcePath = asString(options.actualImagePath);
  let headedSnapshotPath: string | null = null;

  if (!actualSourcePath) {
    const snapshotResult = await runCommand(
      requestJson,
      options.coreBaseUrl,
      "snapshot",
      {
        fullPage: options.fullPage ?? true,
        timeoutMs,
      },
      options.sessionId,
    );

    actualSourcePath = asString(snapshotResult.path);
    if (!actualSourcePath) {
      throw new Error("snapshot command did not return result.path");
    }
    headedSnapshotPath = actualSourcePath;
  }

  const compareResult = await runCommand(
    requestJson,
    options.coreBaseUrl,
    "compare-reference",
    {
      actualImagePath: actualSourcePath,
      referenceImagePath,
      label,
      writeDiff: options.writeDiff ?? true,
    },
    options.sessionId,
  );

  const artifactDir = asString(compareResult.artifactDir);
  const runId = asString(compareResult.runId);
  if (!artifactDir || !runId) {
    throw new Error("compare-reference response missing artifactDir/runId");
  }

  const artifacts = ensureObject(compareResult.artifacts ?? {});
  const metrics = compareResult.metrics && typeof compareResult.metrics === "object"
    ? (compareResult.metrics as ParityMetrics)
    : null;

  const copiedHeadlessPath = asString(options.headlessImagePath)
    ? copyHeadlessImage(options.headlessImagePath as string, artifactDir)
    : null;

  const notesPath = path.join(artifactDir, "notes.md");
  const notes = buildNotesMarkdown({
    generatedAt: new Date().toISOString(),
    coreBaseUrl: options.coreBaseUrl,
    sessionId: options.sessionId ?? null,
    label,
    actualSourcePath,
    referenceImagePath,
    artifactDir,
    notesPath,
    headedSnapshotPath,
    headlessImagePath: copiedHeadlessPath,
    artifacts: {
      runtimeJsonPath: asString(artifacts.runtimeJsonPath) ?? undefined,
      metricsJsonPath: asString(artifacts.metricsJsonPath) ?? undefined,
      summaryJsonPath: asString(artifacts.summaryJsonPath) ?? undefined,
      actualImagePath: asString(artifacts.actualImagePath) ?? undefined,
      referenceImagePath: asString(artifacts.referenceImagePath) ?? undefined,
      diffImagePath: asString(artifacts.diffImagePath),
    },
    metrics,
  });
  fs.writeFileSync(notesPath, notes, "utf8");

  return {
    runId,
    artifactDir,
    notesPath,
    sessionId: options.sessionId ?? null,
    label,
    actualSourcePath,
    headedSnapshotPath,
    headlessImagePath: copiedHeadlessPath,
    metrics,
    artifacts: {
      runtimeJsonPath: asString(artifacts.runtimeJsonPath) ?? undefined,
      metricsJsonPath: asString(artifacts.metricsJsonPath) ?? undefined,
      summaryJsonPath: asString(artifacts.summaryJsonPath) ?? undefined,
      actualImagePath: asString(artifacts.actualImagePath) ?? undefined,
      referenceImagePath: asString(artifacts.referenceImagePath) ?? undefined,
      diffImagePath: asString(artifacts.diffImagePath),
    },
  };
}

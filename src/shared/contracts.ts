import { z } from "zod";

export const RuntimeEventTypeSchema = z.enum([
  "console",
  "error",
  "unhandledrejection",
  "network",
  "perf",
  "command",
  "trace",
]);

export const RuntimeEventSchema = z.object({
  ts: z.string(),
  sessionId: z.string(),
  tabUrl: z.string().optional(),
  eventType: RuntimeEventTypeSchema,
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  message: z.string().optional(),
  network: z
    .object({
      method: z.string().optional(),
      url: z.string().optional(),
      status: z.number().int().optional(),
      durationMs: z.number().optional(),
      requestBody: z.unknown().optional(),
      responseBody: z.unknown().optional(),
      truncated: z.boolean().optional(),
    })
    .optional(),
  exception: z
    .object({
      name: z.string().optional(),
      stack: z.string().optional(),
    })
    .optional(),
  perf: z
    .object({
      name: z.string(),
      value: z.number(),
    })
    .optional(),
  redactionApplied: z.boolean(),
  marker: z.string().optional(),
  tag: z.string().optional(),
  event: z.string().optional(),
  traceId: z.string().optional(),
  source: z.string().optional(),
  issueTag: z.string().optional(),
  correlationId: z.string().optional(),
  data: z.unknown().optional(),
});

export const RuntimeEventInputSchema = z.object({
  ts: z.string().optional(),
  tabUrl: z.string().optional(),
  eventType: RuntimeEventTypeSchema.default("console"),
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  message: z.string().optional(),
  network: z.unknown().optional(),
  exception: z.unknown().optional(),
  perf: z.unknown().optional(),
  data: z.unknown().optional(),
  tag: z.string().optional(),
  event: z.string().optional(),
  traceId: z.string().optional(),
  marker: z.string().optional(),
});

export const CoreEventsRequestSchema = z.object({
  sessionId: z.string(),
  events: z.array(RuntimeEventInputSchema).min(1),
});

export const DebugTraceEventSchema = z.object({
  marker: z.literal("BUGFIX_TRACE"),
  tag: z.string().min(1),
  event: z.string().min(1),
  traceId: z.string().optional(),
  ts: z.string().optional(),
  data: z.unknown().optional(),
  sessionId: z.string().optional(),
});

export const DebugTraceBatchSchema = z.object({
  events: z.array(DebugTraceEventSchema).min(1),
  sessionId: z.string().optional(),
});

export const SessionStartRequestSchema = z.object({
  tabUrl: z.string().min(1),
  debugPort: z.number().int().positive().default(9222),
});

export const SessionStopRequestSchema = z.object({
  sessionId: z.string().min(1),
});

export const CommandSchema = z.enum(["reload", "click", "type", "snapshot"]);

export const ReloadPayloadSchema = z.object({
  waitUntil: z.enum(["load"]).default("load"),
  timeoutMs: z.number().int().positive().default(15000),
});

export const ClickPayloadSchema = z.object({
  selector: z.string().min(1),
  timeoutMs: z.number().int().positive().default(10000),
});

export const TypePayloadSchema = z.object({
  selector: z.string().min(1),
  text: z.string(),
  clear: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(10000),
});

export const SnapshotPayloadSchema = z.object({
  fullPage: z.boolean().default(true),
  timeoutMs: z.number().int().positive().default(20000),
});

const CommandPayloadSchema = z.union([
  ReloadPayloadSchema,
  ClickPayloadSchema,
  TypePayloadSchema,
  SnapshotPayloadSchema,
]);

export const CommandRequestSchema = z.object({
  sessionId: z.string().min(1),
  command: CommandSchema,
  payload: CommandPayloadSchema.default({}),
});

export const QueryRequestSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  tag: z.string().optional(),
  traceId: z.string().optional(),
  sessionId: z.string().optional(),
  eventType: RuntimeEventTypeSchema.optional(),
  limit: z.coerce.number().int().positive().max(2000).default(500),
});

export const QueryResponseSchema = z.object({
  count: z.number().int().nonnegative(),
  truncated: z.boolean(),
  events: z.array(RuntimeEventSchema),
});

export const NetworkAllowlistRuleSchema = z.object({
  method: z.string().min(1),
  urlPattern: z.string().min(1),
  maxBytes: z.number().int().positive().max(1_048_576),
  captureRequestBody: z.boolean().default(true),
  captureResponseBody: z.boolean().default(false),
});

export const ProjectRuntimeConfigSchema = z.object({
  version: z.literal(1),
  projectId: z.string().min(1),
  appUrl: z.string().url(),
  agent: z.object({
    host: z.string().min(1),
    corePort: z.number().int().positive(),
    debugPort: z.number().int().positive(),
  }),
  browser: z.object({
    cdpPort: z.number().int().positive().default(9222),
  }),
  capture: z.object({
    allowedDomains: z.array(z.string().min(1)).min(1),
    networkAllowlist: z.array(NetworkAllowlistRuleSchema).default([]),
  }),
  defaults: z.object({
    queryWindowMinutes: z.number().int().positive().max(24 * 60).default(30),
  }),
});

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
export type RuntimeEventInput = z.infer<typeof RuntimeEventInputSchema>;
export type DebugTraceEvent = z.infer<typeof DebugTraceEventSchema>;
export type QueryRequest = z.infer<typeof QueryRequestSchema>;
export type QueryResponse = z.infer<typeof QueryResponseSchema>;
export type CommandRequest = z.infer<typeof CommandRequestSchema>;
export type ProjectRuntimeConfig = z.infer<typeof ProjectRuntimeConfigSchema>;
export type NetworkAllowlistRule = z.infer<typeof NetworkAllowlistRuleSchema>;

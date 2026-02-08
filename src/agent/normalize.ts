import crypto from "node:crypto";
import {
  DebugTraceEvent,
  RuntimeEvent,
  RuntimeEventInput,
  RuntimeEventTypeSchema,
} from "../shared/contracts.js";
import { isoNow } from "../utils/time.js";
import { redactUnknown } from "./redaction.js";

function normalizeEventType(raw?: string): RuntimeEvent["eventType"] {
  const parsed = RuntimeEventTypeSchema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  return "console";
}

function ensureCorrelationId(traceId?: string): string {
  return traceId ?? crypto.randomUUID();
}

export function normalizeRuntimeEvent(event: RuntimeEventInput, sessionId: string): RuntimeEvent {
  const redactedMessage = redactUnknown(event.message ?? "");
  const redactedNetwork = redactUnknown(event.network);
  const redactedException = redactUnknown(event.exception);
  const redactedPerf = redactUnknown(event.perf);
  const redactedData = redactUnknown(event.data);

  return {
    ts: event.ts ?? isoNow(),
    sessionId,
    tabUrl: event.tabUrl,
    eventType: normalizeEventType(event.eventType),
    level: event.level ?? "info",
    message: redactedMessage.data,
    network: redactedNetwork.data as RuntimeEvent["network"],
    exception: redactedException.data as RuntimeEvent["exception"],
    perf: redactedPerf.data as RuntimeEvent["perf"],
    redactionApplied:
      redactedMessage.redactionApplied ||
      redactedNetwork.redactionApplied ||
      redactedException.redactionApplied ||
      redactedPerf.redactionApplied ||
      redactedData.redactionApplied,
    marker: event.marker,
    tag: event.tag,
    event: event.event,
    traceId: event.traceId,
    source: "extension",
    issueTag: event.tag,
    correlationId: ensureCorrelationId(event.traceId),
    data: redactedData.data,
  };
}

export function normalizeDebugTraceEvent(event: DebugTraceEvent, sessionId: string): RuntimeEvent {
  const redactedData = redactUnknown(event.data);
  const redactedEventName = redactUnknown(event.event);

  return {
    ts: event.ts ?? isoNow(),
    sessionId,
    eventType: "trace",
    level: "info",
    message: `${event.tag}:${redactedEventName.data}`,
    redactionApplied: redactedData.redactionApplied || redactedEventName.redactionApplied,
    marker: event.marker,
    tag: event.tag,
    event: redactedEventName.data,
    traceId: event.traceId,
    source: "bugfix-trace",
    issueTag: event.tag,
    correlationId: ensureCorrelationId(event.traceId),
    data: redactedData.data,
  };
}

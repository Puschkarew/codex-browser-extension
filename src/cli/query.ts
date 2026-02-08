import { getArg } from "./args.js";
import { getCoreBaseUrl, requestJson } from "./http.js";

type QueryResponse = {
  count: number;
  truncated: boolean;
  events: Array<Record<string, unknown>>;
};

function usage(): never {
  throw new Error(
    "Usage: npm run agent:query -- --from <ISO> --to <ISO> [--tag <tag>] [--traceId <id>] [--session <id>] [--eventType <type>] [--limit <n>]",
  );
}

async function main(): Promise<void> {
  const from = getArg("--from");
  const to = getArg("--to");

  if (!from || !to) {
    usage();
  }

  const params = new URLSearchParams({ from, to });

  const tag = getArg("--tag");
  const traceId = getArg("--traceId");
  const session = getArg("--session");
  const eventType = getArg("--eventType");
  const limit = getArg("--limit");

  if (tag) params.set("tag", tag);
  if (traceId) params.set("traceId", traceId);
  if (session) params.set("sessionId", session);
  if (eventType) params.set("eventType", eventType);
  if (limit) params.set("limit", limit);

  const result = await requestJson<QueryResponse>(`${getCoreBaseUrl()}/events/query?${params.toString()}`);
  console.log(JSON.stringify(result, null, 2));
}

void main();

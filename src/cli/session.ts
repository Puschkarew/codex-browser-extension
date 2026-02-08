import { getArg, hasFlag } from "./args.js";
import { getCoreBaseUrl, requestJson } from "./http.js";

type HealthResponse = {
  appUrl: string;
  readiness?: {
    cdpPort?: number;
  };
};

type SessionEnsureResponse = {
  sessionId: string;
  ingestToken: string;
  state: string;
  attachedTargetUrl: string;
  reused: boolean;
};

async function main(): Promise<void> {
  const baseUrl = getCoreBaseUrl();
  const health = await requestJson<HealthResponse>(`${baseUrl}/health`);

  const tabUrl = getArg("--tab-url") ?? health.appUrl;
  const debugPortRaw = Number(getArg("--debug-port") ?? "");
  const debugPort = Number.isFinite(debugPortRaw) && debugPortRaw > 0
    ? Math.floor(debugPortRaw)
    : Number(health.readiness?.cdpPort ?? 9222);

  const result = await requestJson<SessionEnsureResponse>(`${baseUrl}/session/ensure`, {
    method: "POST",
    body: JSON.stringify({
      tabUrl,
      debugPort,
      reuseActive: !hasFlag("--no-reuse"),
    }),
  });

  console.log(JSON.stringify(result, null, 2));
}

void main();

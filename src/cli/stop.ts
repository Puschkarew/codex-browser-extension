import { getCoreBaseUrl, requestJson } from "./http.js";

type HealthResponse = {
  activeSession:
    | false
    | {
        sessionId: string;
      };
};

async function main(): Promise<void> {
  const baseUrl = getCoreBaseUrl();
  const health = await requestJson<HealthResponse>(`${baseUrl}/health`);

  if (!health.activeSession) {
    console.log("No active session");
    return;
  }

  const result = await requestJson<{ sessionId: string; state: string }>(`${baseUrl}/session/stop`, {
    method: "POST",
    body: JSON.stringify({ sessionId: health.activeSession.sessionId }),
  });

  console.log(JSON.stringify(result, null, 2));
}

void main();

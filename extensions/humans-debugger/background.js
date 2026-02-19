const STORAGE_KEY = "agentRuntime";
const LOOPBACK_HOST = "127.0.0.1";
const CORE_PORT_START = 4678;
const CORE_PORT_END = 4698;

const state = {
  connected: false,
  sessionId: null,
  ingestToken: null,
  currentDomain: null,
  lastError: null,
  coreBaseUrl: null,
  projectId: null,
  appUrl: null,
  cdpPort: 9222,
  allowedDomains: ["localhost", "127.0.0.1"],
  captureRules: [],
  runReadinessStatus: null,
  runReadinessMode: null,
  runReadinessSummary: null,
  runReadinessNextAction: null,
  runReadinessCommand: null,
};

function generateCoreBaseCandidates() {
  const candidates = [];
  for (let port = CORE_PORT_START; port <= CORE_PORT_END; port += 1) {
    candidates.push(`http://${LOOPBACK_HOST}:${port}`);
  }
  return candidates;
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function wildcardMatch(input, pattern) {
  if (!pattern.includes("*")) {
    return input === pattern;
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(input);
}

function hostnameAllowed(hostname, patterns) {
  return patterns.some((pattern) => wildcardMatch(hostname.toLowerCase(), pattern.toLowerCase()));
}

function updateState(patch) {
  Object.assign(state, patch);
  chrome.runtime.sendMessage({ type: "status-updated", status: state }).catch(() => undefined);
}

function runReadinessPatchFromHealth(health) {
  const runReadiness = health?.runReadiness ?? null;
  return {
    runReadinessStatus: runReadiness?.status ?? null,
    runReadinessMode: runReadiness?.modeHint ?? null,
    runReadinessSummary: runReadiness?.summary ?? null,
    runReadinessNextAction: runReadiness?.nextAction?.hint ?? null,
    runReadinessCommand: runReadiness?.nextAction?.command ?? null,
  };
}

async function getStoredRuntime() {
  const payload = await chrome.storage.local.get(STORAGE_KEY);
  return payload[STORAGE_KEY] ?? {};
}

async function setStoredRuntime(patch) {
  const current = await getStoredRuntime();
  await chrome.storage.local.set({
    [STORAGE_KEY]: {
      ...current,
      ...patch,
    },
  });
}

async function requestJson(url, init = {}, timeoutMs = 800) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    const text = await response.text();
    const json = text ? JSON.parse(text) : {};

    if (!response.ok) {
      throw new Error(json?.error?.message ?? `${response.status} ${response.statusText}`);
    }

    return json;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveCoreBase(forceScan = false) {
  const stored = await getStoredRuntime();
  const candidates = unique([
    !forceScan ? stored.resolvedCoreBase : null,
    ...(Array.isArray(stored.coreBaseCandidates) ? stored.coreBaseCandidates : []),
    ...generateCoreBaseCandidates(),
  ]);

  for (const candidate of candidates) {
    try {
      const health = await requestJson(`${candidate}/health`, {}, 600);
      if (health.status === "ok") {
        await setStoredRuntime({
          coreBaseCandidates: candidates,
          resolvedCoreBase: candidate,
        });

        updateState({
          connected: true,
          coreBaseUrl: candidate,
          lastError: null,
          ...runReadinessPatchFromHealth(health),
        });

        return { coreBaseUrl: candidate, health };
      }
    } catch {
      // continue scanning
    }
  }

  updateState({
    connected: false,
    coreBaseUrl: null,
    lastError: "Agent unavailable",
    runReadinessStatus: null,
    runReadinessMode: null,
    runReadinessSummary: null,
    runReadinessNextAction: null,
    runReadinessCommand: null,
  });

  return null;
}

async function broadcastRuntimeConfig(captureRules, allowedDomains) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  await Promise.all(
    tabs
      .filter((tab) => typeof tab.id === "number")
      .map((tab) =>
        chrome.tabs
          .sendMessage(tab.id, {
            type: "runtimeConfig",
            captureRules,
            allowedDomains,
          })
          .catch(() => undefined),
      ),
  );
}

async function syncRuntimeConfig(forceScan = false) {
  const resolved = await resolveCoreBase(forceScan);
  if (!resolved) {
    throw new Error("Agent unavailable");
  }

  const runtimeConfig = await requestJson(`${resolved.coreBaseUrl}/runtime/config`, {}, 1200);

  const allowedDomains = runtimeConfig?.capture?.allowedDomains ?? ["localhost", "127.0.0.1"];
  const captureRules = runtimeConfig?.capture?.networkAllowlist ?? [];

  updateState({
    connected: true,
    coreBaseUrl: resolved.coreBaseUrl,
    projectId: runtimeConfig?.projectId ?? null,
    appUrl: runtimeConfig?.appUrl ?? null,
    cdpPort: runtimeConfig?.browser?.cdpPort ?? 9222,
    allowedDomains,
    captureRules,
    lastError: null,
    ...runReadinessPatchFromHealth(resolved.health),
  });

  await setStoredRuntime({
    coreBaseCandidates: generateCoreBaseCandidates(),
    resolvedCoreBase: resolved.coreBaseUrl,
    lastProjectId: runtimeConfig?.projectId ?? null,
  });

  await broadcastRuntimeConfig(captureRules, allowedDomains);

  return runtimeConfig;
}

async function getActiveTabUrl() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.url ?? null;
}

async function startSession() {
  await syncRuntimeConfig();

  const currentUrl = await getActiveTabUrl();
  if (!currentUrl) {
    throw new Error("No active tab URL found");
  }

  const parsed = new URL(currentUrl);
  if (!hostnameAllowed(parsed.hostname, state.allowedDomains)) {
    throw new Error(`Domain ${parsed.hostname} is not allowlisted`);
  }

  const payload = await requestJson(`${state.coreBaseUrl}/session/start`, {
    method: "POST",
    body: JSON.stringify({
      tabUrl: currentUrl,
      debugPort: state.cdpPort,
    }),
  });

  updateState({
    connected: true,
    sessionId: payload.sessionId,
    ingestToken: payload.ingestToken,
    currentDomain: parsed.hostname,
    lastError: null,
  });
  void syncRuntimeConfig(true).catch(() => undefined);

  return payload;
}

async function stopSession() {
  if (!state.sessionId || !state.coreBaseUrl) {
    return { state: "idle" };
  }

  const payload = await requestJson(`${state.coreBaseUrl}/session/stop`, {
    method: "POST",
    body: JSON.stringify({ sessionId: state.sessionId }),
  });

  updateState({
    sessionId: null,
    ingestToken: null,
    currentDomain: null,
    lastError: null,
  });
  void syncRuntimeConfig(true).catch(() => undefined);

  return payload;
}

async function sendEvents(events) {
  if (!state.sessionId || !state.ingestToken) {
    return { accepted: 0, rejected: events.length };
  }

  if (!state.coreBaseUrl) {
    await syncRuntimeConfig();
  }

  try {
    return await requestJson(`${state.coreBaseUrl}/events`, {
      method: "POST",
      headers: {
        "X-Ingest-Token": state.ingestToken,
      },
      body: JSON.stringify({
        sessionId: state.sessionId,
        events,
      }),
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (text.includes("INVALID_INGEST_TOKEN")) {
      updateState({
        sessionId: null,
        ingestToken: null,
        connected: false,
        lastError: "Ingest token rejected",
      });
    }

    return { accepted: 0, rejected: events.length };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const run = async () => {
    if (message.type === "getStatus") {
      await syncRuntimeConfig();
      return state;
    }

    if (message.type === "refreshConfig") {
      await syncRuntimeConfig(true);
      return state;
    }

    if (message.type === "getRuntimeConfig") {
      await syncRuntimeConfig();
      return {
        captureRules: state.captureRules,
        allowedDomains: state.allowedDomains,
      };
    }

    if (message.type === "startSession") {
      return startSession();
    }

    if (message.type === "stopSession") {
      return stopSession();
    }

    if (message.type === "events") {
      return sendEvents(message.events ?? []);
    }

    return { ok: false, reason: "Unknown message type" };
  };

  run()
    .then((result) => sendResponse(result))
    .catch((error) => {
      const messageText = error instanceof Error ? error.message : String(error);
      updateState({ lastError: messageText });
      sendResponse({ ok: false, error: messageText });
    });

  return true;
});

setInterval(() => {
  void syncRuntimeConfig().catch(() => undefined);
}, 5000);

void syncRuntimeConfig().catch(() => undefined);

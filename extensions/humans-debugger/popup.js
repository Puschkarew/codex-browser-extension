const agent = document.getElementById("agent");
const core = document.getElementById("core");
const project = document.getElementById("project");
const app = document.getElementById("app");
const session = document.getElementById("session");
const domain = document.getElementById("domain");
const readiness = document.getElementById("readiness");
const nextAction = document.getElementById("nextAction");
const errorEl = document.getElementById("error");

function render(status) {
  agent.textContent = status.connected ? "Connected" : "Disconnected";
  agent.className = status.connected ? "status-ok" : "status-bad";

  core.textContent = status.coreBaseUrl ?? "-";
  project.textContent = status.projectId ?? "-";
  app.textContent = status.appUrl ?? "-";
  session.textContent = status.sessionId ?? "-";
  domain.textContent = status.currentDomain ?? "-";
  if (status.runReadinessStatus) {
    const modeSuffix = status.runReadinessMode ? ` (${status.runReadinessMode})` : "";
    readiness.textContent = `${status.runReadinessStatus}${modeSuffix}`;
    readiness.className =
      status.runReadinessStatus === "runnable"
        ? "status-ok"
        : status.runReadinessStatus === "fallback"
          ? "status-warn"
          : "status-bad";
  } else {
    readiness.textContent = "-";
    readiness.className = "";
  }
  nextAction.textContent = status.runReadinessNextAction ?? status.runReadinessSummary ?? "-";
  errorEl.textContent = status.lastError ?? "";
}

async function request(type) {
  return chrome.runtime.sendMessage({ type });
}

async function refresh() {
  try {
    const status = await request("getStatus");
    render(status);
  } catch (error) {
    render({
      connected: false,
      coreBaseUrl: null,
      projectId: null,
      appUrl: null,
      sessionId: null,
      currentDomain: null,
      runReadinessStatus: null,
      runReadinessMode: null,
      runReadinessSummary: null,
      runReadinessNextAction: null,
      lastError: String(error),
    });
  }
}

document.getElementById("start").addEventListener("click", async () => {
  await request("startSession");
  await refresh();
});

document.getElementById("stop").addEventListener("click", async () => {
  await request("stopSession");
  await refresh();
});

document.getElementById("refresh").addEventListener("click", async () => {
  await request("refreshConfig");
  await refresh();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "status-updated") {
    render(message.status);
  }
});

void refresh();

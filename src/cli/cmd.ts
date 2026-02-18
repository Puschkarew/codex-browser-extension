import { getArg, hasFlag } from "./args.js";
import { getCoreBaseUrl, requestJson } from "./http.js";

type CommandResponse = {
  ok: boolean;
  result: Record<string, unknown>;
};

function usage(): never {
  throw new Error(
    "Usage: npm run agent:cmd -- --do <reload|wait|navigate|evaluate|click|type|snapshot|compare-reference|webgl-diagnostics> [--session <id>] [--ms <value>] [--url <value>] [--expr <js>] [--selector <css>] [--text <value>] [--clear] [--timeout <ms>] [--fullPage] [--actual <path>] [--reference <path>] [--label <name>] [--dimension-policy <strict|resize-reference-to-actual>] [--resize-interpolation <nearest|bilinear>] [--noDiff] [--no-await-promise] [--no-return-by-value]",
  );
}

async function main(): Promise<void> {
  const sessionId = getArg("--session");
  const command = getArg("--do");

  if (!command) {
    usage();
  }

  const timeout = Number(getArg("--timeout") ?? "");
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : undefined;

  let payload: Record<string, unknown> = {};

  if (command === "reload") {
    payload = { waitUntil: "load", ...(timeoutMs ? { timeoutMs } : {}) };
  } else if (command === "wait") {
    const msRaw = Number(getArg("--ms") ?? getArg("--timeout") ?? "");
    if (!Number.isFinite(msRaw) || msRaw <= 0) {
      usage();
    }
    payload = { ms: Math.floor(msRaw) };
  } else if (command === "navigate") {
    const url = getArg("--url");
    if (!url) {
      usage();
    }
    payload = {
      url,
      waitUntil: "load",
      ...(timeoutMs ? { timeoutMs } : {}),
    };
  } else if (command === "evaluate") {
    const expression = getArg("--expr");
    if (!expression) {
      usage();
    }
    payload = {
      expression,
      awaitPromise: !hasFlag("--no-await-promise"),
      returnByValue: !hasFlag("--no-return-by-value"),
      ...(timeoutMs ? { timeoutMs } : {}),
    };
  } else if (command === "click") {
    const selector = getArg("--selector");
    if (!selector) {
      usage();
    }
    payload = { selector, ...(timeoutMs ? { timeoutMs } : {}) };
  } else if (command === "type") {
    const selector = getArg("--selector");
    const text = getArg("--text");
    if (!selector || typeof text !== "string") {
      usage();
    }
    payload = {
      selector,
      text,
      clear: hasFlag("--clear"),
      ...(timeoutMs ? { timeoutMs } : {}),
    };
  } else if (command === "snapshot") {
    payload = { fullPage: hasFlag("--fullPage"), ...(timeoutMs ? { timeoutMs } : {}) };
  } else if (command === "compare-reference") {
    const actualImagePath = getArg("--actual");
    const referenceImagePath = getArg("--reference");
    const label = getArg("--label");
    const dimensionPolicy = getArg("--dimension-policy") ?? "strict";
    const resizeInterpolation = getArg("--resize-interpolation") ?? "bilinear";

    if (!actualImagePath || !referenceImagePath) {
      usage();
    }
    if (!["strict", "resize-reference-to-actual"].includes(dimensionPolicy)) {
      usage();
    }
    if (!["nearest", "bilinear"].includes(resizeInterpolation)) {
      usage();
    }

    payload = {
      actualImagePath,
      referenceImagePath,
      ...(label ? { label } : {}),
      writeDiff: !hasFlag("--noDiff"),
      dimensionPolicy,
      resizeInterpolation,
    };
  } else if (command === "webgl-diagnostics") {
    payload = { ...(timeoutMs ? { timeoutMs } : {}) };
  } else {
    usage();
  }

  const requestBody: Record<string, unknown> = { command, payload };
  if (sessionId) {
    requestBody.sessionId = sessionId;
  }

  const result = await requestJson<CommandResponse>(`${getCoreBaseUrl()}/command`, {
    method: "POST",
    body: JSON.stringify(requestBody),
  });

  console.log(JSON.stringify(result, null, 2));
}

void main();

import { getArg, hasFlag } from "./args.js";
import { getCoreBaseUrl, requestJson } from "./http.js";

type CommandResponse = {
  ok: boolean;
  result: Record<string, unknown>;
};

function usage(): never {
  throw new Error(
    "Usage: npm run agent:cmd -- --session <id> --do <reload|click|type|snapshot|compare-reference|webgl-diagnostics> [--selector <css>] [--text <value>] [--clear] [--timeout <ms>] [--fullPage] [--actual <path>] [--reference <path>] [--label <name>] [--noDiff]",
  );
}

async function main(): Promise<void> {
  const sessionId = getArg("--session");
  const command = getArg("--do");

  if (!sessionId || !command) {
    usage();
  }

  const timeout = Number(getArg("--timeout") ?? "");
  const timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : undefined;

  let payload: Record<string, unknown> = {};

  if (command === "reload") {
    payload = { waitUntil: "load", ...(timeoutMs ? { timeoutMs } : {}) };
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

    if (!actualImagePath || !referenceImagePath) {
      usage();
    }

    payload = {
      actualImagePath,
      referenceImagePath,
      ...(label ? { label } : {}),
      writeDiff: !hasFlag("--noDiff"),
    };
  } else if (command === "webgl-diagnostics") {
    payload = { ...(timeoutMs ? { timeoutMs } : {}) };
  } else {
    usage();
  }

  const result = await requestJson<CommandResponse>(`${getCoreBaseUrl()}/command`, {
    method: "POST",
    body: JSON.stringify({ sessionId, command, payload }),
  });

  console.log(JSON.stringify(result, null, 2));
}

void main();

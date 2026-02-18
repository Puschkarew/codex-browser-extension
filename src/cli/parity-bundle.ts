import { getArg, hasFlag } from "./args.js";
import { getCoreBaseUrl, requestJson } from "./http.js";
import { runParityBundle } from "./parity-bundle-core.js";

function usage(): never {
  throw new Error(
    "Usage: npm run agent:parity-bundle -- --reference <path> [--session <id>] [--label <name>] [--actual <path>] [--headless <path>] [--timeout <ms>] [--fullPage] [--noDiff] [--dimension-policy <strict|resize-reference-to-actual>] [--resize-interpolation <nearest|bilinear>]",
  );
}

function parseTimeoutMs(): number | undefined {
  const timeoutArg = getArg("--timeout");
  if (typeof timeoutArg !== "string") {
    return undefined;
  }
  const timeoutRaw = Number(timeoutArg);
  if (!Number.isFinite(timeoutRaw) || timeoutRaw <= 0) {
    usage();
  }
  return Math.floor(timeoutRaw);
}

async function main(): Promise<void> {
  const referenceImagePath = getArg("--reference");
  if (!referenceImagePath) {
    usage();
  }
  const dimensionPolicy = getArg("--dimension-policy");
  const resizeInterpolation = getArg("--resize-interpolation");
  if (dimensionPolicy && !["strict", "resize-reference-to-actual"].includes(dimensionPolicy)) {
    usage();
  }
  if (resizeInterpolation && !["nearest", "bilinear"].includes(resizeInterpolation)) {
    usage();
  }

  const result = await runParityBundle(
    {
      coreBaseUrl: getCoreBaseUrl(),
      sessionId: getArg("--session"),
      referenceImagePath,
      label: getArg("--label"),
      timeoutMs: parseTimeoutMs(),
      fullPage: hasFlag("--fullPage") ? true : undefined,
      actualImagePath: getArg("--actual"),
      writeDiff: !hasFlag("--noDiff"),
      headlessImagePath: getArg("--headless"),
      dimensionPolicy: (dimensionPolicy as "strict" | "resize-reference-to-actual" | undefined) ?? undefined,
      resizeInterpolation: (resizeInterpolation as "nearest" | "bilinear" | undefined) ?? undefined,
    },
    requestJson,
  );

  console.log(JSON.stringify(result, null, 2));
}

void main();

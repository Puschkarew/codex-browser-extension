import fs from "node:fs";
import path from "node:path";

export type DomainsConfig = {
  allowedDomains: string[];
  allowHttpLocalhost: boolean;
};

export type CaptureBodyRule = {
  method: string;
  urlPattern: string;
  maxBytes: number;
  captureRequestBody: boolean;
  captureResponseBody: boolean;
};

export type NetworkAllowlistConfig = {
  captureBodies: CaptureBodyRule[];
};

function safeReadJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export function loadDomainsConfig(rootDir: string): DomainsConfig {
  const filePath = path.join(rootDir, "config", "domains.json");
  return safeReadJson<DomainsConfig>(filePath, {
    allowedDomains: ["localhost"],
    allowHttpLocalhost: true,
  });
}

export function loadNetworkAllowlistConfig(rootDir: string): NetworkAllowlistConfig {
  const filePath = path.join(rootDir, "config", "network-allowlist.json");
  return safeReadJson<NetworkAllowlistConfig>(filePath, {
    captureBodies: [],
  });
}

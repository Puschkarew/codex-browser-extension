import {
  NetworkAllowlistRule,
  ProjectRuntimeConfig,
  ProjectRuntimeConfigSchema,
} from "../shared/contracts.js";
import { loadDomainsConfig, loadNetworkAllowlistConfig } from "./config.js";

type RuntimeConfigStateOptions = {
  rootDir: string;
  host: string;
  corePort: number;
  debugPort: number;
};

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === "localhost" || normalized === "127.0.0.1";
}

function ensureLoopbackPair(allowedDomains: Set<string>, hostname: string): void {
  if (!isLoopbackHostname(hostname)) {
    return;
  }

  allowedDomains.add("localhost");
  allowedDomains.add("127.0.0.1");
}

function sanitizePort(port: number, fallback: number): number {
  return Number.isInteger(port) && port > 0 ? port : fallback;
}

function buildDefaultConfig(options: RuntimeConfigStateOptions): ProjectRuntimeConfig {
  const domainsConfig = loadDomainsConfig(options.rootDir);
  const networkConfig = loadNetworkAllowlistConfig(options.rootDir);

  const allowedDomains = new Set(domainsConfig.allowedDomains.map((item) => normalizeHostname(item)));
  if (domainsConfig.allowHttpLocalhost) {
    allowedDomains.add("localhost");
    allowedDomains.add("127.0.0.1");
  }

  const defaultAppUrl = "http://localhost:3000";
  const defaultHostname = normalizeHostname(new URL(defaultAppUrl).hostname);
  allowedDomains.add(defaultHostname);
  ensureLoopbackPair(allowedDomains, defaultHostname);

  return ProjectRuntimeConfigSchema.parse({
    version: 1,
    projectId: "default-project",
    appUrl: defaultAppUrl,
    agent: {
      host: options.host,
      corePort: options.corePort,
      debugPort: options.debugPort,
    },
    browser: {
      cdpPort: 9222,
    },
    capture: {
      allowedDomains: Array.from(allowedDomains),
      networkAllowlist: networkConfig.captureBodies,
    },
    defaults: {
      queryWindowMinutes: 30,
    },
  });
}

function withRequiredAgentFields(
  config: ProjectRuntimeConfig,
  options: Pick<RuntimeConfigStateOptions, "host" | "corePort" | "debugPort">,
): ProjectRuntimeConfig {
  const hostName = normalizeHostname(new URL(config.appUrl).hostname);
  const allowedDomains = new Set(config.capture.allowedDomains.map((item) => normalizeHostname(item)));
  allowedDomains.add(hostName);
  ensureLoopbackPair(allowedDomains, hostName);

  return {
    ...config,
    agent: {
      host: options.host,
      corePort: options.corePort,
      debugPort: options.debugPort,
    },
    capture: {
      ...config.capture,
      allowedDomains: Array.from(allowedDomains),
    },
  };
}

export class RuntimeConfigState {
  private readonly options: RuntimeConfigStateOptions;
  private activeConfig: ProjectRuntimeConfig;

  constructor(options: RuntimeConfigStateOptions) {
    this.options = {
      ...options,
      corePort: sanitizePort(options.corePort, 4678),
      debugPort: sanitizePort(options.debugPort, 7331),
    };
    this.activeConfig = buildDefaultConfig(this.options);
  }

  get(): ProjectRuntimeConfig {
    return this.activeConfig;
  }

  getAllowedDomains(): string[] {
    return this.activeConfig.capture.allowedDomains;
  }

  getNetworkAllowlist(): NetworkAllowlistRule[] {
    return this.activeConfig.capture.networkAllowlist;
  }

  set(rawConfig: unknown): ProjectRuntimeConfig {
    const parsed = ProjectRuntimeConfigSchema.parse(rawConfig);
    this.activeConfig = withRequiredAgentFields(parsed, this.options);
    return this.activeConfig;
  }
}

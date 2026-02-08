import CDP from "chrome-remote-interface";

type AttachOptions = {
  tabUrlPattern: string;
  debugPort: number;
};

type CdpClient = {
  Page: {
    enable(): Promise<void>;
    reload(params: { ignoreCache?: boolean }): Promise<void>;
    once(eventName: string, handler: () => void): void;
    captureScreenshot(params: { format: "png"; fromSurface?: boolean }): Promise<{ data: string }>;
  };
  Runtime: {
    enable(): Promise<void>;
    evaluate(params: {
      expression: string;
      returnByValue?: boolean;
      awaitPromise?: boolean;
    }): Promise<{ result: { value?: unknown } }>;
  };
  DOM: {
    enable(): Promise<void>;
  };
  close(): Promise<void>;
};

type ConnectedClient = {
  client: CdpClient;
  attachedTargetUrl: string;
};

export class CdpUnavailableError extends Error {}
export class TargetNotFoundError extends Error {}
export class CommandTimeoutError extends Error {}

const DEFAULT_HOST = "127.0.0.1";

function wildcardMatch(input: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return input === pattern;
  }

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(input);
}

export class CdpController {
  private connected: ConnectedClient | null = null;

  async attach(options: AttachOptions): Promise<string> {
    const target = await this.findTarget(options.tabUrlPattern, options.debugPort);
    if (!target) {
      throw new TargetNotFoundError("No matching target found");
    }

    try {
      const client = (await CDP({
        host: DEFAULT_HOST,
        port: options.debugPort,
        target: target.id,
      })) as CdpClient;

      await client.Page.enable();
      await client.Runtime.enable();
      await client.DOM.enable();

      this.connected = {
        client,
        attachedTargetUrl: target.url,
      };

      return target.url;
    } catch (error) {
      throw new CdpUnavailableError(String(error));
    }
  }

  async detach(): Promise<void> {
    if (this.connected) {
      try {
        await this.connected.client.close();
      } finally {
        this.connected = null;
      }
    }
  }

  hasConnection(): boolean {
    return this.connected !== null;
  }

  async reload(timeoutMs: number): Promise<{ ok: true }> {
    const client = this.requireClient();
    const done = new Promise<void>((resolve) => {
      client.Page.once("loadEventFired", () => resolve());
    });

    await client.Page.reload({ ignoreCache: false });
    await this.withTimeout(done, timeoutMs);
    return { ok: true };
  }

  async click(selector: string, timeoutMs: number): Promise<{ ok: true }> {
    const client = this.requireClient();
    const escaped = JSON.stringify(selector);
    const expression = `(() => {
      const el = document.querySelector(${escaped});
      if (!el) return { ok: false, code: "ELEMENT_NOT_FOUND" };
      (el).click();
      return { ok: true };
    })()`;

    const result = (await this.withTimeout(
      client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true }),
      timeoutMs,
    )) as { result: { value?: { ok: boolean } } };

    const value = result.result.value;
    if (!value?.ok) {
      throw new Error("ELEMENT_NOT_FOUND");
    }

    return { ok: true };
  }

  async type(selector: string, text: string, clear: boolean, timeoutMs: number): Promise<{ ok: true }> {
    const client = this.requireClient();
    const escapedSelector = JSON.stringify(selector);
    const escapedText = JSON.stringify(text);

    const expression = `(() => {
      const el = document.querySelector(${escapedSelector});
      if (!el) return { ok: false, code: "ELEMENT_NOT_FOUND" };
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        return { ok: false, code: "ELEMENT_NOT_TEXT_INPUT" };
      }
      el.focus();
      if (${clear ? "true" : "false"}) {
        el.value = "";
      }
      el.value = ${escapedText};
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true };
    })()`;

    const result = (await this.withTimeout(
      client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true }),
      timeoutMs,
    )) as { result: { value?: { ok: boolean; code?: string } } };

    const value = result.result.value;
    if (!value?.ok) {
      throw new Error(value?.code ?? "TYPE_FAILED");
    }

    return { ok: true };
  }

  async snapshot(timeoutMs: number): Promise<string> {
    const client = this.requireClient();
    const screenshot = (await this.withTimeout(
      client.Page.captureScreenshot({ format: "png", fromSurface: true }),
      timeoutMs,
    )) as { data: string };

    return screenshot.data;
  }

  private async findTarget(
    tabUrlPattern: string,
    debugPort: number,
  ): Promise<{ id: string; url: string } | null> {
    try {
      const targets = (await CDP.List({ host: DEFAULT_HOST, port: debugPort })) as Array<{
        id?: string;
        url: string;
        type: string;
      }>;
      const pageTargets = targets.filter((target) => target.type === "page");

      const directMatch = pageTargets.find((target) => target.url === tabUrlPattern);
      if (directMatch) {
        return { id: String(directMatch.id), url: directMatch.url };
      }

      const wildcardTarget = pageTargets.find((target) => wildcardMatch(target.url, tabUrlPattern));

      if (!wildcardTarget) {
        return null;
      }

      return { id: String(wildcardTarget.id), url: wildcardTarget.url };
    } catch (error) {
      throw new CdpUnavailableError(String(error));
    }
  }

  private requireClient(): CdpClient {
    if (!this.connected) {
      throw new CdpUnavailableError("CDP client is not attached");
    }
    return this.connected.client;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new CommandTimeoutError(`Command timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      promise
        .then((result) => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeout);
          reject(error);
        });
    });
  }
}

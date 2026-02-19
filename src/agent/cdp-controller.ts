import CDP from "chrome-remote-interface";
import type { SessionMatchStrategy } from "../shared/contracts.js";

type AttachOptions = {
  tabUrlPattern: string;
  debugPort: number;
  matchStrategy: SessionMatchStrategy;
};

type CdpClient = {
  Page: {
    enable(): Promise<void>;
    navigate(params: { url: string }): Promise<void>;
    reload(params: { ignoreCache?: boolean }): Promise<void>;
    loadEventFired(): Promise<unknown>;
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
export class AmbiguousTargetError extends Error {
  readonly candidates: Array<{ id: string; url: string }>;

  constructor(candidates: Array<{ id: string; url: string }>) {
    super("Multiple targets match the requested tabUrl");
    this.candidates = candidates;
  }
}

const DEFAULT_HOST = "127.0.0.1";
const LOAD_EVENT_FALLBACK_HINTS = [
  "once is not a function",
  "loadeventfired is not a function",
  "did not return a promise",
];
const DOM_READY_TRANSIENT_HINTS = [
  "execution context was destroyed",
  "cannot find context",
  "context not found",
];

function wildcardMatch(input: string, pattern: string): boolean {
  if (!pattern.includes("*")) {
    return input === pattern;
  }

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}$`, "i");
  return regex.test(input);
}

function parseTargetUrl(rawUrl: string): { origin: string; pathname: string } | null {
  try {
    const parsed = new URL(rawUrl);
    return {
      origin: parsed.origin,
      pathname: parsed.pathname,
    };
  } catch {
    return null;
  }
}

export class CdpController {
  private connected: ConnectedClient | null = null;

  async attach(options: AttachOptions): Promise<string> {
    const target = await this.findTarget(options.tabUrlPattern, options.debugPort, options.matchStrategy);
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
    const loadEvent = this.prepareLoadEventPromise(client);

    try {
      await client.Page.reload({ ignoreCache: false });
      await this.waitForNavigationCompletion(client, loadEvent, timeoutMs);
    } catch (error) {
      if (loadEvent) {
        // Reload can fail before waitForNavigationCompletion consumes loadEvent.
        // Drain pending rejection to avoid process-level unhandledRejection noise.
        void loadEvent.catch(() => undefined);
      }
      throw error;
    }
    return { ok: true };
  }

  async navigate(url: string, timeoutMs: number): Promise<{ ok: true; url: string }> {
    const client = this.requireClient();
    const loadEvent = this.prepareLoadEventPromise(client);

    try {
      await client.Page.navigate({ url });
      await this.waitForNavigationCompletion(client, loadEvent, timeoutMs);
    } catch (error) {
      if (loadEvent) {
        // Navigate can fail before waitForNavigationCompletion consumes loadEvent.
        // Drain pending rejection to avoid process-level unhandledRejection noise.
        void loadEvent.catch(() => undefined);
      }
      throw error;
    }
    return { ok: true, url };
  }

  async wait(ms: number): Promise<{ ok: true; waitedMs: number }> {
    const waitedMs = Math.max(1, Math.floor(ms));
    await new Promise((resolve) => setTimeout(resolve, waitedMs));
    return { ok: true, waitedMs };
  }

  async evaluate(
    expression: string,
    returnByValue: boolean,
    awaitPromise: boolean,
    timeoutMs: number,
  ): Promise<{ ok: true; value: unknown }> {
    const client = this.requireClient();
    const evaluated = (await this.withTimeout(
      client.Runtime.evaluate({
        expression,
        returnByValue,
        awaitPromise,
      }),
      timeoutMs,
    )) as { result: { value?: unknown } };

    return {
      ok: true,
      value: evaluated.result.value,
    };
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

  async webglDiagnostics(timeoutMs: number): Promise<Record<string, unknown>> {
    const client = this.requireClient();
    const expression = `(() => {
      function inspectSceneCanvas() {
        const sceneCanvas = document.querySelector("canvas");
        if (!sceneCanvas) {
          return {
            hasCanvas: false,
            hasWebglContext: false,
            cssWidth: 0,
            cssHeight: 0,
            drawingBufferWidth: 0,
            drawingBufferHeight: 0,
            meanLuminance: null,
            nonBlackRatio: null,
            readPixelsStatus: "not-applicable",
            confidence: "low",
            confidenceReason: "scene canvas not found",
            contextAttributes: null
          };
        }

        const gl = sceneCanvas.getContext("webgl2") || sceneCanvas.getContext("webgl") || sceneCanvas.getContext("experimental-webgl");
        const rect = sceneCanvas.getBoundingClientRect();
        if (!gl) {
          return {
            hasCanvas: true,
            hasWebglContext: false,
            cssWidth: rect.width,
            cssHeight: rect.height,
            drawingBufferWidth: sceneCanvas.width || 0,
            drawingBufferHeight: sceneCanvas.height || 0,
            meanLuminance: null,
            nonBlackRatio: null,
            readPixelsStatus: "no-webgl-context",
            confidence: "low",
            confidenceReason: "scene canvas has no WebGL context",
            contextAttributes: null
          };
        }

        const width = Math.max(1, gl.drawingBufferWidth);
        const height = Math.max(1, gl.drawingBufferHeight);
        const pixels = new Uint8Array(width * height * 4);
        const attributes = typeof gl.getContextAttributes === "function" ? gl.getContextAttributes() : null;
        let readPixelsStatus = "ok";
        try {
          gl.finish();
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        } catch {
          readPixelsStatus = "error";
        }

        if (readPixelsStatus !== "ok") {
          return {
            hasCanvas: true,
            hasWebglContext: true,
            cssWidth: rect.width,
            cssHeight: rect.height,
            drawingBufferWidth: width,
            drawingBufferHeight: height,
            meanLuminance: null,
            nonBlackRatio: null,
            readPixelsStatus,
            confidence: "low",
            confidenceReason: "readPixels failed",
            contextAttributes: attributes
              ? {
                  alpha: attributes.alpha,
                  antialias: attributes.antialias,
                  preserveDrawingBuffer: attributes.preserveDrawingBuffer,
                }
              : null
          };
        }

        let luminanceSum = 0;
        let nonBlackPixels = 0;
        const totalPixels = width * height;
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];
          luminanceSum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (r > 3 || g > 3 || b > 3) {
            nonBlackPixels += 1;
          }
        }
        const nonBlackRatio = totalPixels > 0 ? nonBlackPixels / totalPixels : null;
        const preserveDrawingBuffer = attributes ? attributes.preserveDrawingBuffer : null;
        let confidence = "high";
        let confidenceReason = null;
        if (preserveDrawingBuffer === false) {
          confidence = "low";
          confidenceReason = "preserveDrawingBuffer=false may return cleared framebuffer data";
        } else if (nonBlackRatio === 0) {
          confidence = "low";
          confidenceReason = "framebuffer appears empty while the page may still render via compositor";
        }

        return {
          hasCanvas: true,
          hasWebglContext: true,
          cssWidth: rect.width,
          cssHeight: rect.height,
          drawingBufferWidth: width,
          drawingBufferHeight: height,
          meanLuminance: totalPixels > 0 ? luminanceSum / totalPixels : null,
          nonBlackRatio,
          readPixelsStatus,
          confidence,
          confidenceReason,
          contextAttributes: attributes
            ? {
                alpha: attributes.alpha,
                antialias: attributes.antialias,
                preserveDrawingBuffer: attributes.preserveDrawingBuffer,
              }
            : null
        };
      }

      const canvas = document.createElement("canvas");
      const webgl2 = canvas.getContext("webgl2");
      const webgl = webgl2 || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      const hasWebgl2 = Boolean(webgl2);
      const hasWebgl = Boolean(webgl);

      let extensions = [];
      let vendor = null;
      let renderer = null;
      let version = null;
      let shadingLanguageVersion = null;
      let unmaskedVendor = null;
      let unmaskedRenderer = null;

      if (webgl) {
        try {
          extensions = webgl.getSupportedExtensions() || [];
          vendor = webgl.getParameter(webgl.VENDOR);
          renderer = webgl.getParameter(webgl.RENDERER);
          version = webgl.getParameter(webgl.VERSION);
          shadingLanguageVersion = webgl.getParameter(webgl.SHADING_LANGUAGE_VERSION);
          const rendererInfo = webgl.getExtension("WEBGL_debug_renderer_info");
          if (rendererInfo) {
            unmaskedVendor = webgl.getParameter(rendererInfo.UNMASKED_VENDOR_WEBGL);
            unmaskedRenderer = webgl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL);
          }
        } catch {
          // Continue returning partial diagnostics.
        }
      }

      const userAgent = navigator.userAgent || "";
      const uaLower = userAgent.toLowerCase();
      const hasHeadlessUaHint = uaLower.includes("headless");
      const hasWebdriver = Boolean(navigator.webdriver);

      return {
        contexts: {
          webgl: hasWebgl,
          webgl2: hasWebgl2
        },
        scene: inspectSceneCanvas(),
        extensions,
        renderer: {
          vendor,
          renderer,
          version,
          shadingLanguageVersion,
          unmaskedVendor,
          unmaskedRenderer
        },
        environment: {
          userAgent,
          webdriver: hasWebdriver,
          hasHeadlessUaHint,
          headlessLikely: hasHeadlessUaHint || hasWebdriver
        }
      };
    })()`;

    const evaluated = (await this.withTimeout(
      client.Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true }),
      timeoutMs,
    )) as { result: { value?: unknown } };

    const diagnostics = evaluated.result.value;
    if (!diagnostics || typeof diagnostics !== "object") {
      throw new Error("WEBGL_DIAGNOSTICS_EMPTY");
    }

    return diagnostics as Record<string, unknown>;
  }

  private async findTarget(
    tabUrlPattern: string,
    debugPort: number,
    matchStrategy: SessionMatchStrategy,
  ): Promise<{ id: string; url: string } | null> {
    try {
      const targets = (await CDP.List({ host: DEFAULT_HOST, port: debugPort })) as Array<{
        id?: string;
        url: string;
        type: string;
      }>;
      const pageTargets = targets.filter((target) => target.type === "page");

      if (tabUrlPattern.includes("*")) {
        const wildcardTarget = pageTargets.find((target) => wildcardMatch(target.url, tabUrlPattern));
        if (!wildcardTarget) {
          return null;
        }
        return { id: String(wildcardTarget.id), url: wildcardTarget.url };
      }

      if (matchStrategy === "exact") {
        const directMatch = pageTargets.find((target) => target.url === tabUrlPattern);
        if (!directMatch) {
          return null;
        }
        return { id: String(directMatch.id), url: directMatch.url };
      }

      const requested = parseTargetUrl(tabUrlPattern);
      if (!requested) {
        return null;
      }

      const matched = pageTargets
        .map((target) => ({
          id: String(target.id),
          url: target.url,
          parsed: parseTargetUrl(target.url),
        }))
        .filter((target) => {
          if (!target.parsed) {
            return false;
          }
          if (matchStrategy === "origin-path") {
            return target.parsed.origin === requested.origin && target.parsed.pathname === requested.pathname;
          }
          return target.parsed.origin === requested.origin;
        })
        .map((target) => ({
          id: target.id,
          url: target.url,
        }));

      if (matched.length === 0) {
        return null;
      }

      if (matched.length > 1) {
        throw new AmbiguousTargetError(matched);
      }

      return matched[0] ?? null;
    } catch (error) {
      if (error instanceof AmbiguousTargetError) {
        throw error;
      }
      throw new CdpUnavailableError(String(error));
    }
  }

  private requireClient(): CdpClient {
    if (!this.connected) {
      throw new CdpUnavailableError("CDP client is not attached");
    }
    return this.connected.client;
  }

  private prepareLoadEventPromise(client: CdpClient): Promise<unknown> | null {
    const loadEventFired = client.Page.loadEventFired;
    if (typeof loadEventFired !== "function") {
      return null;
    }

    try {
      const maybePromise = loadEventFired.call(client.Page);
      if (!maybePromise || typeof (maybePromise as Promise<unknown>).then !== "function") {
        return Promise.reject(new Error("Page.loadEventFired did not return a promise"));
      }
      return maybePromise as Promise<unknown>;
    } catch (error) {
      if (this.shouldFallbackFromLoadEvent(error)) {
        return null;
      }
      throw error;
    }
  }

  private async waitForNavigationCompletion(
    client: CdpClient,
    loadEvent: Promise<unknown> | null,
    timeoutMs: number,
  ): Promise<void> {
    if (loadEvent) {
      try {
        await this.withTimeout(loadEvent, timeoutMs);
        return;
      } catch (error) {
        if (!this.shouldFallbackFromLoadEvent(error)) {
          throw error;
        }
      }
    }

    await this.waitForDocumentReadyState(client, timeoutMs);
  }

  private async waitForDocumentReadyState(client: CdpClient, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + Math.max(1, timeoutMs);
    while (Date.now() < deadline) {
      const remaining = Math.max(1, deadline - Date.now());
      const probeTimeout = Math.max(1, Math.min(remaining, 250));
      try {
        const evaluated = (await this.withTimeout(
          client.Runtime.evaluate({
            expression: "document.readyState",
            returnByValue: true,
            awaitPromise: true,
          }),
          probeTimeout,
        )) as { result: { value?: unknown } };
        const readyState = evaluated.result?.value;
        if (readyState === "interactive" || readyState === "complete") {
          return;
        }
      } catch (error) {
        if (!this.isTransientDomReadyProbeError(error)) {
          throw error;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, 50)));
    }

    throw new CommandTimeoutError(`Command timed out after ${timeoutMs}ms`);
  }

  private shouldFallbackFromLoadEvent(error: unknown): boolean {
    if (error instanceof CommandTimeoutError) {
      return false;
    }
    const message = String(error).toLowerCase();
    return LOAD_EVENT_FALLBACK_HINTS.some((hint) => message.includes(hint));
  }

  private isTransientDomReadyProbeError(error: unknown): boolean {
    if (error instanceof CommandTimeoutError) {
      return true;
    }
    const message = String(error).toLowerCase();
    return DOM_READY_TRANSIENT_HINTS.some((hint) => message.includes(hint));
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

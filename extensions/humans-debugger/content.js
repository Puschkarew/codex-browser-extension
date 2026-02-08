(() => {
  if (window.__HUMANS_DEBUGGER_INSTALLED__) {
    return;
  }

  window.__HUMANS_DEBUGGER_INSTALLED__ = true;

  const fallbackRules = [
    {
      method: "POST",
      urlPattern: "https://api.dev.example.com/v1/*",
      maxBytes: 32768,
      captureRequestBody: true,
      captureResponseBody: false,
    },
  ];

  let captureRules = [...fallbackRules];

  function wildcardMatch(input, pattern) {
    if (!pattern.includes("*")) {
      return input === pattern;
    }
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    const regex = new RegExp(`^${escaped}$`, "i");
    return regex.test(input);
  }

  function applyRuntimeConfig(runtimeConfig) {
    if (Array.isArray(runtimeConfig?.captureRules)) {
      captureRules = runtimeConfig.captureRules;
    }
  }

  function shouldCaptureBody(method, url) {
    const upperMethod = method.toUpperCase();
    const rule = captureRules.find(
      (item) => upperMethod === item.method && wildcardMatch(String(url), String(item.urlPattern)),
    );
    return rule ?? null;
  }

  function send(event) {
    chrome.runtime
      .sendMessage({
        type: "events",
        events: [event],
      })
      .catch(() => undefined);
  }

  function baseEvent(eventType, payload = {}) {
    return {
      ts: new Date().toISOString(),
      eventType,
      tabUrl: location.href,
      ...payload,
    };
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "runtimeConfig") {
      applyRuntimeConfig(message);
    }
  });

  chrome.runtime
    .sendMessage({ type: "getRuntimeConfig" })
    .then((runtimeConfig) => applyRuntimeConfig(runtimeConfig))
    .catch(() => undefined);

  window.addEventListener("error", (errorEvent) => {
    send(
      baseEvent("error", {
        level: "error",
        message: errorEvent.message,
        exception: {
          name: errorEvent.error?.name ?? "Error",
          stack: errorEvent.error?.stack,
        },
      }),
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    send(
      baseEvent("unhandledrejection", {
        level: "error",
        message: "Unhandled promise rejection",
        data: {
          reason: String(event.reason),
        },
      }),
    );
  });

  const consoleLevels = ["debug", "log", "info", "warn", "error"];
  for (const level of consoleLevels) {
    const original = console[level];
    console[level] = (...args) => {
      send(
        baseEvent("console", {
          level: level === "log" ? "info" : level,
          message: args.map((item) => String(item)).join(" "),
          data: { args },
        }),
      );
      original.apply(console, args);
    };
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const startedAt = performance.now();
    const [input, init] = args;
    const method = init?.method ?? "GET";
    const url = typeof input === "string" ? input : input.url;
    const bodyRule = shouldCaptureBody(method, url);

    try {
      const response = await originalFetch(...args);
      const durationMs = Math.round(performance.now() - startedAt);

      const payload = {
        level: response.ok ? "info" : "warn",
        message: `${method} ${url}`,
        network: {
          method,
          url,
          status: response.status,
          durationMs,
        },
      };

      if (bodyRule && bodyRule.captureRequestBody && init?.body) {
        const serialized = typeof init.body === "string" ? init.body : "[binary/body-not-string]";
        payload.network.requestBody = serialized.slice(0, bodyRule.maxBytes);
        payload.network.truncated = serialized.length > bodyRule.maxBytes;
      }

      send(baseEvent("network", payload));
      return response;
    } catch (error) {
      send(
        baseEvent("network", {
          level: "error",
          message: `${method} ${url}`,
          network: {
            method,
            url,
            status: 0,
            durationMs: Math.round(performance.now() - startedAt),
          },
          exception: { name: "FetchError", stack: String(error) },
        }),
      );
      throw error;
    }
  };

  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
    this.__debugMethod = method;
    this.__debugUrl = String(url);
    return originalXhrOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function sendXhr(body) {
    const startedAt = performance.now();
    const method = this.__debugMethod ?? "GET";
    const url = this.__debugUrl ?? "unknown";
    const bodyRule = shouldCaptureBody(method, url);

    this.addEventListener("loadend", () => {
      const payload = {
        method,
        url,
        status: this.status,
        durationMs: Math.round(performance.now() - startedAt),
      };

      if (bodyRule && bodyRule.captureRequestBody && typeof body === "string") {
        payload.requestBody = body.slice(0, bodyRule.maxBytes);
        payload.truncated = body.length > bodyRule.maxBytes;
      }

      send(
        baseEvent("network", {
          level: this.status >= 400 ? "warn" : "info",
          message: `${method} ${url}`,
          network: payload,
        }),
      );
    });

    return originalXhrSend.call(this, body);
  };
})();

import { describe, expect, it } from "vitest";
import { CdpController, CdpUnavailableError, CommandTimeoutError } from "../src/agent/cdp-controller.js";

type FakeRuntimeValue = {
  result: {
    value?: unknown;
  };
};

function createFakeController(
  runtimeValue: FakeRuntimeValue,
  options: {
    loadEventFired?: () => Promise<unknown>;
    navigate?: (params: { url: string }) => Promise<void>;
    reload?: () => Promise<void>;
  } = {},
): CdpController {
  const controller = new CdpController();
  const fakeClient = {
    Page: {
      enable: async () => undefined,
      reload: options.reload
        ? async () => options.reload?.()
        : async () => undefined,
      navigate: options.navigate
        ? async (params: { url: string }) => options.navigate?.(params)
        : async () => undefined,
      loadEventFired: options.loadEventFired
        ? async () => options.loadEventFired?.()
        : async () => undefined,
      captureScreenshot: async () => ({ data: "" }),
    },
    Runtime: {
      enable: async () => undefined,
      evaluate: async () => runtimeValue,
    },
    DOM: {
      enable: async () => undefined,
    },
    close: async () => undefined,
  };

  (controller as unknown as { connected: unknown }).connected = {
    client: fakeClient,
    attachedTargetUrl: "http://localhost:3000",
  };

  return controller;
}

describe("CdpController commands", () => {
  it("reload succeeds when load event resolves", async () => {
    const controller = createFakeController({ result: { value: {} } });
    await expect(controller.reload(100)).resolves.toEqual({ ok: true });
  });

  it("navigate succeeds when load event resolves", async () => {
    const controller = createFakeController({ result: { value: {} } });
    await expect(controller.navigate("http://localhost:3000/page", 100)).resolves.toEqual({
      ok: true,
      url: "http://localhost:3000/page",
    });
  });

  it("reload times out when load event does not fire", async () => {
    const controller = createFakeController(
      { result: { value: {} } },
      {
        loadEventFired: async () => new Promise(() => undefined),
      },
    );

    await expect(controller.reload(10)).rejects.toBeInstanceOf(CommandTimeoutError);
  });

  it("navigate times out when load event does not fire", async () => {
    const controller = createFakeController(
      { result: { value: {} } },
      {
        loadEventFired: async () => new Promise(() => undefined),
      },
    );

    await expect(controller.navigate("http://localhost:3000/page", 10)).rejects.toBeInstanceOf(CommandTimeoutError);
  });

  it("returns evaluated diagnostics object when CDP connection is present", async () => {
    const controller = createFakeController({
      result: {
        value: {
          contexts: { webgl: true, webgl2: true },
          environment: { headlessLikely: false },
        },
      },
    });

    const diagnostics = await controller.webglDiagnostics(1000);
    expect(diagnostics.contexts).toEqual({ webgl: true, webgl2: true });
    expect(diagnostics.environment).toEqual({ headlessLikely: false });
  });

  it("throws when diagnostics payload is empty", async () => {
    const controller = createFakeController({
      result: {
        value: undefined,
      },
    });

    await expect(controller.webglDiagnostics(1000)).rejects.toThrow("WEBGL_DIAGNOSTICS_EMPTY");
  });

  it("throws CdpUnavailableError when no CDP connection exists", async () => {
    const controller = new CdpController();
    await expect(controller.webglDiagnostics(1000)).rejects.toBeInstanceOf(CdpUnavailableError);
  });
});

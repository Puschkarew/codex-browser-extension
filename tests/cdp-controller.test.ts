import { describe, expect, it } from "vitest";
import { CdpController, CdpUnavailableError } from "../src/agent/cdp-controller.js";

type FakeRuntimeValue = {
  result: {
    value?: unknown;
  };
};

function createFakeController(runtimeValue: FakeRuntimeValue): CdpController {
  const controller = new CdpController();
  const fakeClient = {
    Page: {
      enable: async () => undefined,
      reload: async () => undefined,
      once: (_eventName: string, _handler: () => void) => undefined,
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

describe("CdpController webglDiagnostics", () => {
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

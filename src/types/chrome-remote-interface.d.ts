declare module "chrome-remote-interface" {
  type CdpTarget = {
    id?: string;
    url: string;
    type: string;
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

  function CDP(options: { host: string; port: number; target: string }): Promise<CdpClient>;

  namespace CDP {
    function List(options: { host: string; port: number }): Promise<CdpTarget[]>;
  }

  export = CDP;
}

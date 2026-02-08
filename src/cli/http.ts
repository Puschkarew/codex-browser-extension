export async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const bodyText = await response.text();
  const body = bodyText ? (JSON.parse(bodyText) as T | { error: { code: string; message: string } }) : ({} as T);

  if (!response.ok) {
    const error = (body as { error?: { code?: string; message?: string } }).error;
    throw new Error(`${response.status} ${error?.code ?? "HTTP_ERROR"}: ${error?.message ?? bodyText}`);
  }

  return body as T;
}

export function getCoreBaseUrl(): string {
  const port = Number(process.env.CORE_PORT ?? 4678);
  return `http://127.0.0.1:${port}`;
}

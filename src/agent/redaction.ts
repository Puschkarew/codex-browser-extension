const SENSITIVE_KEYS = new Set([
  "password",
  "pass",
  "token",
  "auth",
  "authorization",
  "cookie",
  "set-cookie",
  "api-key",
  "apikey",
  "secret",
]);

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_REGEX = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
const JWT_REGEX = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const CARD_REGEX = /\b(?:\d[ -]*?){13,19}\b/g;

export type RedactionResult<T> = {
  data: T;
  redactionApplied: boolean;
};

function redactString(value: string): RedactionResult<string> {
  let next = value;
  let changed = false;

  const replacements: Array<[RegExp, string]> = [
    [EMAIL_REGEX, "[REDACTED_EMAIL]"],
    [BEARER_REGEX, "Bearer [REDACTED_TOKEN]"],
    [JWT_REGEX, "[REDACTED_JWT]"],
    [CARD_REGEX, "[REDACTED_CARD]"],
  ];

  for (const [regex, replacement] of replacements) {
    const replaced = next.replace(regex, replacement);
    if (replaced !== next) {
      changed = true;
      next = replaced;
    }
  }

  return { data: next, redactionApplied: changed };
}

function keyLooksSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return Array.from(SENSITIVE_KEYS).some((sensitive) => lower.includes(sensitive));
}

function redactUnknownInternal(value: unknown): RedactionResult<unknown> {
  if (typeof value === "string") {
    return redactString(value);
  }

  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const result = redactUnknownInternal(item);
      changed ||= result.redactionApplied;
      return result.data;
    });

    return { data: items, redactionApplied: changed };
  }

  if (value && typeof value === "object") {
    let changed = false;
    const output: Record<string, unknown> = {};

    for (const [key, raw] of Object.entries(value)) {
      if (keyLooksSensitive(key)) {
        output[key] = "[REDACTED]";
        changed = true;
        continue;
      }

      const result = redactUnknownInternal(raw);
      output[key] = result.data;
      changed ||= result.redactionApplied;
    }

    return { data: output, redactionApplied: changed };
  }

  return { data: value, redactionApplied: false };
}

export function redactUnknown<T>(value: T): RedactionResult<T> {
  const result = redactUnknownInternal(value);
  return {
    data: result.data as T,
    redactionApplied: result.redactionApplied,
  };
}

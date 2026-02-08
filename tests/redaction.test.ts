import { describe, expect, it } from "vitest";
import { redactUnknown } from "../src/agent/redaction.js";

describe("redactUnknown", () => {
  it("redacts sensitive keys and common secret patterns", () => {
    const input = {
      email: "user@example.com",
      authorization: "Bearer abc.def.ghi",
      token: "top-secret",
      note: "card 4242 4242 4242 4242",
      nested: {
        password: "hello",
      },
    };

    const result = redactUnknown(input);

    expect(result.redactionApplied).toBe(true);
    expect(result.data.email).toBe("[REDACTED_EMAIL]");
    expect(result.data.authorization).toBe("[REDACTED]");
    expect(result.data.token).toBe("[REDACTED]");
    expect(result.data.note).toContain("[REDACTED_CARD]");
    expect(result.data.nested.password).toBe("[REDACTED]");
  });
});

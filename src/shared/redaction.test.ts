import { describe, expect, it } from "vitest";
import { redactText } from "./redaction";

describe("redactText", () => {
  it("redacts email addresses", () => {
    expect(redactText("contact jane.doe@example.com today")).toBe("contact [redacted-email] today");
  });

  it("redacts provider API tokens", () => {
    expect(redactText("use sk_abcdefgh1234567890123456 carefully")).toBe("use [redacted-token] carefully");
  });

  it("redacts JWT-style tokens", () => {
    const jwt = `${"a".repeat(32)}.${"b".repeat(16)}.${"c".repeat(16)}`;
    expect(redactText(`token ${jwt} end`)).toBe("token [redacted-token] end");
  });

  it("keeps the key name when redacting assignments", () => {
    expect(redactText("password=hunter2000")).toBe("password=[redacted-secret]");
    expect(redactText("api_key: s3cr3tvalue123")).toBe("api_key=[redacted-secret]");
  });

  it("never leaks the $1 placeholder", () => {
    expect(redactText("token=supersecret99")).not.toContain("$1");
  });

  it("redacts phone-like numbers", () => {
    expect(redactText("call +49 30 1234567 now")).toBe("call [redacted-phone] now");
  });

  it("leaves normal text untouched", () => {
    const text = "SHA-256 produces a 256-bit digest for any input.";
    expect(redactText(text)).toBe(text);
  });
});

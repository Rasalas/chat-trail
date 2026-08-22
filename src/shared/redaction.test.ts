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
    expect(redactText("call 030 12345678 now")).toBe("call [redacted-phone] now");
  });

  it("redacts IBANs with and without grouping spaces", () => {
    expect(redactText("pay to DE89 3704 0044 0532 0130 00 please")).toBe(
      "pay to [redacted-iban] please"
    );
    expect(redactText("pay to DE89370400440532013000 please")).toBe(
      "pay to [redacted-iban] please"
    );
  });

  it("keeps short alphanumeric groups that only look like IBAN fragments", () => {
    expect(redactText("order AB12 3456 CD was shipped")).toBe("order AB12 3456 CD was shipped");
  });

  it("redacts credit card numbers that pass the Luhn check", () => {
    expect(redactText("card 4539148803436467 on file")).toBe("card [redacted-card] on file");
    expect(redactText("card 4539 1488 0343 6467 on file")).toBe("card [redacted-card] on file");
  });

  it("keeps digit runs that fail the Luhn check for other rules to handle", () => {
    const invalid = "1234 5678 9012 3456";
    expect(redactText(`note ${invalid} end`)).not.toContain("[redacted-card]");
  });

  it("redacts AWS access key IDs", () => {
    expect(redactText("key AKIAIOSFODNN7EXAMPLE is old")).toBe("key [redacted-aws-key] is old");
  });

  it("leaves normal text untouched", () => {
    const text = "SHA-256 produces a 256-bit digest for any input.";
    expect(redactText(text)).toBe(text);
  });
});

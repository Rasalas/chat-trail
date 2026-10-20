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

  it("redacts common phone formats", () => {
    for (const phone of ["+49 170 1234567", "(030) 1234567", "030/1234567", "+1 415-555-0132", "415.555.0132"]) {
      expect(redactText(`call ${phone} now`)).toBe("call [redacted-phone] now");
    }
  });

  it("keeps dates, times, IP addresses, versions and plain numbers", () => {
    for (const text of [
      "2024-01-15",
      "2024-01-15 10:30",
      "15.01.2024",
      "01/15/2024",
      "10:30:45",
      "192.168.100.200",
      "1.2.3.4.5",
      "10.0.0.1",
      "2019-2024",
      "1 000 000",
      "1 2 3 4 5 6 7",
      "2024/01/15",
      "12345678"
    ]) {
      expect(redactText(`value ${text} end`)).toBe(`value ${text} end`);
    }
  });

  it("keeps parentheses around a redacted phone number", () => {
    expect(redactText("office (+49 30 1234567) only")).toBe("office ([redacted-phone]) only");
  });

  it("redacts a phone number that follows a date", () => {
    expect(redactText("on 2024-01-15 call +49 170 1234567")).toBe("on 2024-01-15 call [redacted-phone]");
  });

  it("redacts each of several phone numbers in a row", () => {
    expect(redactText("Call +1 202-555-0123 / 202-555-0199 end")).toBe("Call [redacted-phone] / [redacted-phone] end");
    expect(redactText("Call 202-555-0123 202-555-0199 end")).toBe("Call [redacted-phone] [redacted-phone] end");
    expect(redactText("tel 030 1234567, 0171 2345678")).toBe("tel [redacted-phone], [redacted-phone]");
  });

  it("redacts short local numbers and international formats with an area code in parentheses", () => {
    expect(redactText("phone: 555-0123 end")).toBe("phone: [redacted-phone] end");
    expect(redactText("call +1 (415) 555-0132 now")).toBe("call [redacted-phone] now");
    expect(redactText("call +4917012345678 now")).toBe("call [redacted-phone] now");
    expect(redactText("call 017012345678 now")).toBe("call [redacted-phone] now");
    expect(redactText("call +49 (0) 30 1234567 now")).toBe("call [redacted-phone] now");
  });

  it("keeps unseparated IDs and timestamps", () => {
    for (const text of ["ID: 1234567890 end", "ID: 123456789012 end", "ts 1729425600 end"]) {
      expect(redactText(text)).toBe(text);
    }
  });

  it("keeps a date in front of a phone number instead of reading both as a card", () => {
    expect(redactText("2026-10-20 030 12345678")).toBe("2026-10-20 [redacted-phone]");
    expect(redactText("on 2024/01/15 call 030 1234567")).toBe("on 2024/01/15 call [redacted-phone]");
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
    expect(redactText("card 4539-1488-0343-6467 on file")).toBe("card [redacted-card] on file");
    expect(redactText("amex 3782 822463 10005 on file")).toBe("amex [redacted-card] on file");
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

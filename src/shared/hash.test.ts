import { describe, expect, it } from "vitest";
import { sha256Hex, stableId } from "./hash";

describe("sha256Hex", () => {
  it("matches the known digest for abc", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("hashes bytes identically to their text", async () => {
    const bytes = new TextEncoder().encode("abc");
    expect(await sha256Hex(bytes)).toBe(await sha256Hex("abc"));
  });
});

describe("stableId", () => {
  it("is deterministic for the same input", () => {
    expect(stableId("user", "hello")).toBe(stableId("user", "hello"));
  });

  it("does not depend on list position", () => {
    expect(stableId("assistant", "body")).not.toMatch(/-\d+-/);
  });

  it("differs by role or text", () => {
    expect(stableId("user", "a")).not.toBe(stableId("assistant", "a"));
    expect(stableId("user", "a")).not.toBe(stableId("user", "b"));
  });
});

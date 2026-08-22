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
    expect(stableId("user", 0, "hello")).toBe(stableId("user", 0, "hello"));
  });

  it("embeds role and 1-based index", () => {
    const id = stableId("assistant", 4, "body");
    expect(id.startsWith("assistant-5-")).toBe(true);
  });

  it("differs for different text", () => {
    expect(stableId("user", 0, "a")).not.toBe(stableId("user", 0, "b"));
  });
});

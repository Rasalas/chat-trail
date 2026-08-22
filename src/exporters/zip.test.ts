import { describe, expect, it } from "vitest";
import { createZip } from "./zip";

const EOCD_SIZE = 22;

async function zipBytes(files: Array<{ name: string; data: string | Uint8Array }>): Promise<Uint8Array> {
  const blob = createZip(files);
  return new Uint8Array(await blob.arrayBuffer());
}

describe("createZip", () => {
  it("starts with a local file header signature", async () => {
    const bytes = await zipBytes([{ name: "a.txt", data: "A" }]);
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("ends with an end-of-central-directory record", async () => {
    const bytes = await zipBytes([{ name: "a.txt", data: "A" }]);
    const eocd = bytes.slice(bytes.length - EOCD_SIZE);
    expect(Array.from(eocd.slice(0, 4))).toEqual([0x50, 0x4b, 0x05, 0x06]);
    const entryCount = eocd[10] | (eocd[11] << 8);
    expect(entryCount).toBe(1);
  });

  it("stores the entry name and consistent sizes", async () => {
    const data = "Hello World";
    const bytes = await zipBytes([{ name: "greeting.txt", data }]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("greeting.txt");

    const nameLength = bytes[26] | (bytes[27] << 8);
    expect(nameLength).toBe("greeting.txt".length);

    const sizeField = bytes[18] | (bytes[19] << 8) | (bytes[20] << 16) | (bytes[21] << 24);
    expect(sizeField).toBe(data.length);

    const stored = bytes.slice(30 + nameLength, 30 + nameLength + sizeField);
    expect(new TextDecoder().decode(stored)).toBe(data);
  });

  it("supports multiple files", async () => {
    const bytes = await zipBytes([
      { name: "one.txt", data: "1" },
      { name: "two.txt", data: "2" }
    ]);
    const eocd = bytes.slice(bytes.length - EOCD_SIZE);
    const entryCount = eocd[10] | (eocd[11] << 8);
    expect(entryCount).toBe(2);
  });
});

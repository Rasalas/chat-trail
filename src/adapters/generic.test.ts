import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { genericAdapter } from "./generic";

vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "0.0.0-test" }) } });

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/generic-chat.html");

let window: Window;

beforeAll(() => {
  window = new Window({ url: "https://example.org/chat" });
  window.document.write(readFileSync(fixturePath, "utf8"));
});

describe("genericAdapter against the fixture page", () => {
  it("matches any page as the fallback adapter", () => {
    expect(genericAdapter.matches(new URL("https://example.org/chat"), window.document as unknown as Document)).toBe(true);
  });

  it("extracts both fixture messages with roles", async () => {
    const conversation = await genericAdapter.extract(window.document as unknown as Document);
    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages[0].role).toBe("user");
    expect(conversation.messages[1].role).toBe("assistant");
  });

  it("captures code blocks from assistant messages", async () => {
    const conversation = await genericAdapter.extract(window.document as unknown as Document);
    const codeBlocks = conversation.messages[1].content.filter((block) => block.type === "code");
    expect(codeBlocks).toEqual([{ type: "code", language: undefined, text: 'sha256("hello")' }]);
  });

  it("fills source metadata from the page", async () => {
    const conversation = await genericAdapter.extract(window.document as unknown as Document);
    expect(conversation.source.provider).toBe("generic");
    expect(conversation.source.url).toBe("https://example.org/chat");
    expect(conversation.source.title).toBe("Fixture Generic Chat");
    expect(conversation.manifest.extension_version).toBe("0.0.0-test");
  });
});

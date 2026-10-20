import { describe, expect, it, vi } from "vitest";
import { selectAdapter } from "./index";

vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "0.0.0-test" }) } });

function page(title: string, html = ""): Document {
  document.title = title;
  document.body.innerHTML = html;
  return document;
}

describe("selectAdapter", () => {
  it("prefers the host adapter over the Claude title heuristic", () => {
    expect(selectAdapter(new URL("https://poe.com/chat/abc"), page("Claude-Sonnet-4 - Poe")).id).toBe("poe");
    expect(selectAdapter(new URL("https://www.perplexity.ai/search/x"), page("Claude vs GPT")).id).toBe("perplexity");
  });

  it("prefers the host adapter over the ChatGPT DOM heuristic", () => {
    const doc = page("Chat", `<div data-message-author-role="user">Hi</div>`);
    expect(selectAdapter(new URL("https://gemini.google.com/app/abc"), doc).id).toBe("gemini");
  });

  it("matches provider hosts", () => {
    expect(selectAdapter(new URL("https://chatgpt.com/c/1"), page("Claude ideas")).id).toBe("chatgpt");
    expect(selectAdapter(new URL("https://claude.ai/chat/1"), page("ChatGPT notes")).id).toBe("claude");
  });

  it("still applies heuristics on unknown hosts", () => {
    expect(selectAdapter(new URL("https://example.com/"), page("Chat", `<div data-message-author-role="user">Hi</div>`)).id).toBe("chatgpt");
    expect(selectAdapter(new URL("https://example.com/"), page("Plain page")).id).toBe("generic");
  });
});

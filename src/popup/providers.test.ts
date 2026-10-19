import { describe, expect, it } from "vitest";
import { describePage, pageStatus } from "./providers";

describe("describePage", () => {
  it("labels known chat hosts", () => {
    expect(describePage("https://chatgpt.com/c/abc")).toEqual({ kind: "provider", label: "ChatGPT" });
    expect(describePage("https://gemini.google.com/app/1")).toEqual({ kind: "provider", label: "Gemini" });
    expect(describePage("https://poe.com/Claude-Sonnet-4")).toEqual({ kind: "provider", label: "Poe" });
  });

  it("separates other web pages, restricted pages and missing urls", () => {
    expect(describePage("https://example.com/blog")).toEqual({ kind: "web" });
    expect(describePage("chrome://extensions")).toEqual({ kind: "restricted" });
    expect(describePage("https://chromewebstore.google.com/detail/x")).toEqual({ kind: "restricted" });
    expect(describePage(undefined)).toEqual({ kind: "unknown" });
  });
});

describe("pageStatus", () => {
  it("warns on unsupported pages instead of reporting an error", () => {
    expect(pageStatus({ kind: "web" }).state).toBe("warning");
    expect(pageStatus({ kind: "restricted" }).state).toBe("error");
    expect(pageStatus({ kind: "provider", label: "Claude" }).text).toBe("Claude detected. Ready to capture.");
  });
});

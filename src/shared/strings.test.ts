import { describe, expect, it } from "vitest";
import { compactWhitespace, escapeHtml, normalizeUrlForPrivacy, slugify } from "./strings";

describe("compactWhitespace", () => {
  it("collapses whitespace runs and trims", () => {
    expect(compactWhitespace("  a\n\n b\t c  ")).toBe("a b c");
  });
});

describe("slugify", () => {
  it("slugs titles", () => {
    expect(slugify("My Chat: Ideas & Notes!")).toBe("my-chat-ideas-notes");
  });

  it("falls back when empty", () => {
    expect(slugify("???")).toBe("chat-trail");
  });
});

describe("escapeHtml", () => {
  it("escapes markup characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#039;&lt;/a&gt;");
  });
});

describe("normalizeUrlForPrivacy", () => {
  it("strips query and fragment", () => {
    expect(normalizeUrlForPrivacy("https://example.com/c/1?q=secret#top")).toBe("https://example.com/c/1");
  });

  it("returns empty string for invalid urls", () => {
    expect(normalizeUrlForPrivacy("not a url")).toBe("");
  });
});

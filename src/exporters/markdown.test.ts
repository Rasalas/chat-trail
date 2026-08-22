import { describe, expect, it } from "vitest";
import { exportMarkdown } from "./markdown";
import { makeConversation, makeMessage } from "../testing/fixtures";

describe("exportMarkdown", () => {
  it("renders frontmatter with source metadata", () => {
    const markdown = exportMarkdown(makeConversation([]));
    expect(markdown).toContain("---");
    expect(markdown).toContain('provider: "generic"');
    expect(markdown).toContain('title: "Test Chat"');
    expect(markdown).toContain("# Test Chat");
  });

  it("numbers role headings", () => {
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "q" }]),
      makeMessage("assistant", 1, [{ type: "text", text: "a" }])
    ]);
    expect(exportMarkdown(conversation)).toContain("## 1. User");
    expect(exportMarkdown(conversation)).toContain("## 2. Assistant");
  });

  it("fences code blocks with their language", () => {
    const conversation = makeConversation([
      makeMessage("assistant", 0, [{ type: "code", language: "ts", text: "const x = 1;" }])
    ]);
    expect(exportMarkdown(conversation)).toContain("```ts\nconst x = 1;\n```");
  });

  it("prefixes quotes", () => {
    const conversation = makeConversation([
      makeMessage("assistant", 0, [{ type: "quote", text: "line one\nline two" }])
    ]);
    expect(exportMarkdown(conversation)).toContain("> line one\n> line two");
  });
});

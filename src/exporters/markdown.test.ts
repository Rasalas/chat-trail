import { describe, expect, it } from "vitest";
import { exportMarkdown } from "./markdown";
import { makeConversation, makeMessage } from "../testing/fixtures";

describe("exportMarkdown", () => {
  it("renders frontmatter and title quote", () => {
    const markdown = exportMarkdown(makeConversation([]));
    expect(markdown).toContain('provider: "generic"');
    expect(markdown).toContain('title: "Test Chat"');
    expect(markdown).toContain("# Test Chat");
    expect(markdown).toContain("> https://example.com/chat?ref=x");
  });

  it("quotes user messages and leaves assistant answers plain", () => {
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "q" }]),
      makeMessage("assistant", 1, [{ type: "text", text: "a" }])
    ]);
    const markdown = exportMarkdown(conversation);
    expect(markdown).toContain("> q");
    expect(markdown).toMatch(/\n\na\n/);
    expect(markdown).not.toContain("> a");
  });

  it("fences code blocks with their language", () => {
    const conversation = makeConversation([
      makeMessage("assistant", 0, [{ type: "code", language: "ts", text: "const x = 1;" }])
    ]);
    expect(exportMarkdown(conversation)).toContain("```ts\nconst x = 1;\n```");
  });

  it("prefixes quote blocks as nested quotes", () => {
    const conversation = makeConversation([
      makeMessage("assistant", 0, [{ type: "quote", text: "line one\nline two" }])
    ]);
    expect(exportMarkdown(conversation)).toContain("> > line one\n> > line two");
  });

  it("keeps empty lines inside quoted user messages", () => {
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "line one\n\nline two" }])
    ]);
    expect(exportMarkdown(conversation)).toContain("> line one\n>\n> line two");
  });

  it("collapses interim assistant messages into previous-messages details", () => {
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "q" }]),
      makeMessage("assistant", 1, [{ type: "text", text: "thinking out loud" }]),
      makeMessage("assistant", 2, [{ type: "text", text: "final answer" }]),
      makeMessage("user", 3, [{ type: "text", text: "next" }]),
      makeMessage("assistant", 4, [{ type: "text", text: "answer two" }])
    ]);
    const markdown = exportMarkdown(conversation);
    expect(markdown).toContain("<details><summary>1 previous message</summary>");
    expect(markdown).toContain("\nthinking out loud\n");
    expect(markdown).toContain("</details>");
    expect(markdown).toContain("\n\nfinal answer\n\n");
    expect(markdown.indexOf("<details>")).toBeLessThan(markdown.indexOf("final answer"));
  });

  it("uses activity labels as the details summary", () => {
    const thinking = makeMessage("assistant", 1, [{ type: "text", text: "Dachte 11 s nach" }]);
    thinking.metadata.kind = "activity";
    const tools = makeMessage("assistant", 2, [{ type: "text", text: "Web durchsucht" }]);
    tools.metadata.kind = "activity";
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "q" }]),
      thinking,
      tools,
      makeMessage("assistant", 3, [{ type: "text", text: "final answer" }])
    ]);
    const markdown = exportMarkdown(conversation);
    expect(markdown).toContain("<details><summary>Dachte 11 s nach · Web durchsucht</summary>");
    expect(markdown).not.toContain("previous message");
  });

  it("combines activity labels with a count for mixed collapsed runs", () => {
    const thinking = makeMessage("assistant", 1, [{ type: "text", text: "Dachte 18 s nach" }]);
    thinking.metadata.kind = "activity";
    const reasoning = makeMessage("assistant", 2, [{ type: "text", text: "Ausführliche Überlegung" }]);
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "q" }]),
      thinking,
      reasoning,
      makeMessage("assistant", 3, [{ type: "text", text: "final answer" }])
    ]);
    const markdown = exportMarkdown(conversation);
    expect(markdown).toContain("<details><summary>Dachte 18 s nach · 1 previous message</summary>");
    expect(markdown).toContain("\nAusführliche Überlegung\n");
  });

  it("uses a plural summary for several interim messages", () => {
    const conversation = makeConversation([
      makeMessage("assistant", 0, [{ type: "text", text: "one" }]),
      makeMessage("assistant", 1, [{ type: "text", text: "two" }]),
      makeMessage("assistant", 2, [{ type: "text", text: "three" }])
    ]);
    expect(exportMarkdown(conversation)).toContain("<details><summary>2 previous messages</summary>");
  });
});

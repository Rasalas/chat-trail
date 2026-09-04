// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { exportHtml } from "./html";
import { makeConversation, makeMessage } from "../testing/fixtures";

describe("exportHtml", () => {
  it("escapes message content to prevent injection", () => {
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "<script>alert(1)</script>" }])
    ]);
    const html = exportHtml(conversation);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("marks messages with their role class", () => {
    const conversation = makeConversation([
      makeMessage("assistant", 0, [{ type: "text", text: "Answer" }])
    ]);
    expect(exportHtml(conversation)).toContain('<div class="message-row assistant">');
  });

  it("renders code blocks inside pre/code", () => {
    const conversation = makeConversation([
      makeMessage("assistant", 0, [{ type: "code", language: "js", text: "if (a < b) {}" }])
    ]);
    const html = exportHtml(conversation);
    expect(html).toContain("<pre><code>if (a &lt; b) {}</code></pre>");
  });

  it("renders markdown in text blocks", () => {
    const conversation = makeConversation([
      makeMessage("assistant", 0, [{ type: "text", text: "#### Tag 1\n\n**08:30** Abfahrt." }])
    ]);
    const html = exportHtml(conversation);
    expect(html).toContain("<h4>Tag 1</h4>");
    expect(html).toContain("<strong>08:30</strong>");
  });

  it("keeps source metadata in the header", () => {
    const html = exportHtml(makeConversation([]));
    expect(html).toContain("generic · 2026-01-01T00:00:00.000Z · https://example.com/chat?ref=x");
  });
});

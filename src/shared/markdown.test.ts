import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("escapes html before applying markdown", () => {
    expect(renderMarkdown('<script>alert("x")</script>')).toContain("&lt;script&gt;");
    expect(renderMarkdown('<script>alert("x")</script>')).not.toContain("<script>");
  });

  it("renders headings, bold, italic, code and strike", () => {
    const html = renderMarkdown("# Titel\n\n**fett** *kursiv* `code` ~~weg~~");
    expect(html).toContain("<h1>Titel</h1>");
    expect(html).toContain("<strong>fett</strong>");
    expect(html).toContain("<em>kursiv</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<del>weg</del>");
  });

  it("renders links and images with safe urls only", () => {
    const html = renderMarkdown("[Label](https://example.com) ![alt](https://example.com/x.png)");
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('<img src="https://example.com/x.png"');
    expect(renderMarkdown("[klick](javascript:alert(1))")).not.toContain("<a href=");
  });

  it("renders flat and nested lists", () => {
    const html = renderMarkdown("- a\n- b\n  - b1\n  - b2\n- c");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>a</li>");
    expect(html).toContain("<li>b<ul><li>b1</li><li>b2</li></ul></li>");
    expect(html).toContain("<li>c</li>");
  });

  it("renders ordered lists", () => {
    const html = renderMarkdown("1. eins\n2. zwei");
    expect(html).toContain("<ol><li>eins</li><li>zwei</li></ol>");
  });

  it("renders tables with header separator", () => {
    const html = renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(html).toContain("<table><thead><tr><th>a</th><th>b</th></tr></thead>");
    expect(html).toContain("<tbody><tr><td>1</td><td>2</td></tr></tbody>");
  });

  it("renders blockquotes recursively", () => {
    const html = renderMarkdown("> **Fazit:** gut\n> weiter");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<strong>Fazit:</strong> gut");
  });

  it("renders fenced code blocks verbatim", () => {
    const html = renderMarkdown("```ts\nconst a = \"<b>\";\n```");
    expect(html).toContain('<pre><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>');
  });

  it("renders horizontal rules", () => {
    expect(renderMarkdown("oben\n\n---\n\nunten")).toContain("<hr>");
  });
});

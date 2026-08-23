import { describe, expect, it } from "vitest";
import { extractContentBlocks } from "./dom";

function root(html: string): Element {
  document.body.innerHTML = `<div id="root">${html}</div>`;
  return document.getElementById("root")!;
}

describe("extractContentBlocks", () => {
  it("renders list items with bullets even when wrapped in paragraphs", async () => {
    const blocks = await extractContentBlocks(root(`<ul><li><p>First</p></li><li><p>Second</p></li></ul>`));
    expect(blocks).toEqual([{ type: "text", text: "- First\n- Second" }]);
  });

  it("numbers ordered lists and indents nested lists", async () => {
    const blocks = await extractContentBlocks(root(`<ol><li>One<ol><li>Nested</li></ol></li><li>Two</li></ol>`));
    expect(blocks).toEqual([{ type: "text", text: "1. One\n  1. Nested\n2. Two" }]);
  });

  it("shifts headings by one level only", async () => {
    const blocks = await extractContentBlocks(root(`<h2>Section</h2><h3>Sub</h3><p>Text</p>`));
    expect(blocks).toEqual([{ type: "text", text: "### Section\n\n#### Sub\n\nText" }]);
  });

  it("cleans citation pills down to a single plain link", async () => {
    const blocks = await extractContentBlocks(
      root(
        `<p>Says hello <span data-testid="webpage-citation-pill"><a href="https://example.com/page">` +
          `<span class="relative"><span class="flex"><span class="min-w-0"><span class="inline-flex shrink-0">` +
          `<img src="https://www.google.com/s2/favicons?domain=example.com&amp;sz=128" alt="">` +
          `<span class="grow truncate">Example Site</span></span></span><span class="-me-1">+2</span></span></span>` +
          `</a></span>.</p>`
      )
    );
    const text = blocks.map((block) => (block.type === "text" ? block.text : "")).join("");
    expect(text).toContain("[Example Site](https://example.com/page)");
    expect(text).not.toContain("favicons");
    expect(text).not.toContain("+2");
  });

  it("preserves author-provided details/summary collapsibles as raw html", async () => {
    const blocks = await extractContentBlocks(
      root(
        `<p>Intro</p>` +
          `<details><summary><strong>Mehr zeigen</strong></summary><p>Versteckter Inhalt mit <b>Fett</b>.</p></details><p>Ende</p>`
      )
    );
    const text = blocks.map((block) => (block.type === "text" ? block.text : "")).join("\n\n");
    expect(text).toContain("<details>");
    expect(text).toContain("<summary>**Mehr zeigen**</summary>");
    expect(text).toContain("Versteckter Inhalt mit **Fett**.");
    expect(text).toContain("</details>");
  });

  it("maps horizontal rules to markdown", async () => {
    const blocks = await extractContentBlocks(root(`<p>Erstens</p><hr><p>Zweitens</p>`));
    const text = blocks.map((block) => (block.type === "text" ? block.text : "")).join("\n\n");
    expect(text).toContain("Erstens\n\n---\n\nZweitens");
  });

  it("harvests carousel images but skips their count badges", async () => {
    const blocks = await extractContentBlocks(
      root(
        `<p>Before</p>` +
          `<div class="group/search-image @container/search-image"><img src="https://images.example.com/x.jpg" alt="pic"><div><span>6</span></div></div>` +
          `<p>After</p>`
      )
    );
    const images = blocks.filter((block) => block.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ src: "https://images.example.com/x.jpg", alt: "pic" });
    const text = blocks.map((block) => (block.type === "text" ? block.text : "")).join(" ");
    expect(text).toContain("Before");
    expect(text).toContain("After");
    expect(text).not.toContain("6");
  });

  it("harvests content images nested in buttons while ignoring button labels", async () => {
    const blocks = await extractContentBlocks(
      root(
        `<p>Intro</p>` +
          `<button type="button" aria-label="Nachricht kopieren"><svg></svg></button>` +
          `<button type="button"><img src="https://images.example.com/photo.jpg" alt="photo"></button>`
      )
    );
    const images = blocks.filter((block) => block.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ src: "https://images.example.com/photo.jpg" });
    const text = blocks.map((block) => (block.type === "text" ? block.text : "")).join(" ");
    expect(text).not.toContain("kopieren");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractFromContainer } from "./generic";

vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "0.0.0-test" }) } });

describe("manual generic container extraction", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <nav>Navigation and unrelated links</nav>
      <article id="story">
        <h1>Eine Meldung</h1>
        <p>Der erste Absatz enthält den eigentlichen Artikeltext.</p>
        <h2>Details</h2>
        <p>Ein weiterer Absatz mit relevanten Informationen.</p>
        <ul><li>Erster Punkt</li><li>Zweiter Punkt</li></ul>
      </article>
      <footer>Footer navigation</footer>`;
  });

  it("captures a selected document as separate assistant sections", async () => {
    const conversation = await extractFromContainer(document.querySelector("#story")!, document);

    expect(conversation.messages).toHaveLength(5);
    expect(conversation.messages.every((message) => message.role === "assistant")).toBe(true);
    expect(conversation.messages.map((message) => message.content[0])).toEqual([
      { type: "text", text: "## Eine Meldung" },
      { type: "text", text: "Der erste Absatz enthält den eigentlichen Artikeltext." },
      { type: "text", text: "### Details" },
      { type: "text", text: "Ein weiterer Absatz mit relevanten Informationen." },
      { type: "text", text: "- Erster Punkt\n- Zweiter Punkt" }
    ]);
  });
});

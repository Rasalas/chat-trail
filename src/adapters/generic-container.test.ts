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

  it("captures a selected document as one assistant message", async () => {
    const conversation = await extractFromContainer(document.querySelector("#story")!, document);

    expect(conversation.messages).toHaveLength(1);
    expect(conversation.messages[0].role).toBe("assistant");
    expect(conversation.messages[0].content).toEqual([
      {
        type: "text",
        text: "## Eine Meldung\n\nDer erste Absatz enthält den eigentlichen Artikeltext.\n\n### Details\n\nEin weiterer Absatz mit relevanten Informationen.\n\n- Erster Punkt\n- Zweiter Punkt"
      }
    ]);
  });
});

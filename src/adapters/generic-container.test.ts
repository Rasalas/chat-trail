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
    expect(conversation.messages.every((message) => message.kind === "document")).toBe(true);
    expect(conversation.messages.map((message) => message.content[0])).toEqual([
      { type: "text", text: "## Eine Meldung" },
      { type: "text", text: "Der erste Absatz enthält den eigentlichen Artikeltext." },
      { type: "text", text: "### Details" },
      { type: "text", text: "Ein weiterer Absatz mit relevanten Informationen." },
      { type: "text", text: "- Erster Punkt\n- Zweiter Punkt" }
    ]);
  });

  it("does not mistake unrelated data-role attributes for chat roles", async () => {
    document.body.innerHTML = `
      <main id="page">
        <div data-role="navigation">Article navigation links</div>
        <h1>Eine Meldung</h1>
        <p>Der ausgewählte Webseiteninhalt bleibt ein Dokument.</p>
      </main>`;

    const conversation = await extractFromContainer(document.querySelector("#page")!, document);

    expect(conversation.messages).toHaveLength(2);
    expect(conversation.messages.every((message) => message.role === "assistant")).toBe(true);
    expect(conversation.messages.every((message) => message.kind === "document")).toBe(true);
  });

  it("keeps explicitly marked user and assistant turns as chat", async () => {
    document.body.innerHTML = `
      <main id="chat">
        <article data-message-author-role="user">Wie lautet die ausführliche Antwort?</article>
        <article data-message-author-role="assistant">Hier steht eine ausreichend lange Antwort.</article>
      </main>`;

    const conversation = await extractFromContainer(document.querySelector("#chat")!, document);

    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(conversation.messages.every((message) => message.kind === undefined)).toBe(true);
  });
});

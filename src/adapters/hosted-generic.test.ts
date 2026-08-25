import { beforeAll, describe, expect, it, vi } from "vitest";
import { Window } from "happy-dom";
import { hostedGenericAdapters } from "./hosted-generic";

vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "0.0.0-test" }) } });

const geminiAdapter = hostedGenericAdapters.find((adapter) => adapter.id === "gemini")!;

let window: Window;

beforeAll(() => {
  window = new Window({ url: "https://gemini.google.com/app/abc" });
  window.document.body.innerHTML = `
    <button data-test-id="bard-mode-menu-button" aria-label="Modusauswahl öffnen, derzeit ausgewählt: Flash">Flash</button>
    <main>
      <aside><a>Einstellungen</a><span>Aktivitäten</span></aside>
      <div class="conversation-container">
        <user-query>
          <span class="cdk-visually-hidden">Du hast gesagt</span>
          Kann man in der Schwangerschaft Burger essen?
        </user-query>
        <model-response>
          <h2 class="cdk-visually-hidden screen-reader-model-response-label">Gemini hat gesagt</h2>
          Nein, bitte vollständig durchgebraten.
        </model-response>
      </div>
      <div class="conversation-container">
        <user-query>Und wenn es doch passiert ist?</user-query>
        <model-response>Ruhe bewahren und die Praxis anrufen.</model-response>
      </div>
    </main>`;
});

describe("gemini hosted adapter", () => {
  it("splits each user query and model response into its own message", async () => {
    const conversation = await geminiAdapter.extract(window.document as unknown as Document);
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(conversation.messages[0].content[0]).toMatchObject({ type: "text", text: "Kann man in der Schwangerschaft Burger essen?" });
    expect(conversation.messages[1].content[0]).toMatchObject({ type: "text", text: "Nein, bitte vollständig durchgebraten." });
  });

  it("keeps screen-reader labels and sidebar chrome out of the messages", async () => {
    const conversation = await geminiAdapter.extract(window.document as unknown as Document);
    const text = JSON.stringify(conversation.messages);
    expect(text).not.toContain("Du hast gesagt");
    expect(text).not.toContain("Gemini hat gesagt");
    expect(text).not.toContain("Einstellungen");
    expect(text).not.toContain("Aktivitäten");
  });

  it("reads the active model from the mode switcher", async () => {
    const conversation = await geminiAdapter.extract(window.document as unknown as Document);
    expect(conversation.source.model).toBe("Flash");
  });

  it("matches the gemini host", () => {
    expect(geminiAdapter.matches(new URL("https://gemini.google.com/app/abc"), window.document as unknown as Document)).toBe(true);
  });

  it("gives gemini messages stable ids from their conversation container and exposes message elements", async () => {
    document.body.innerHTML = `
      <infinite-scroller class="chat-history">
        <div class="conversation-container" id="a56f817d6155b853">
          <user-query><div class="query-text">Frage eins</div></user-query>
          <model-response><message-content id="message-content-id-r_a56f817d6155b853"><p>Antwort eins</p></message-content></model-response>
        </div>
        <div class="conversation-container" id="e64647bbbcd34557">
          <user-query><div class="query-text">Frage zwei</div></user-query>
          <model-response><message-content><p>Antwort zwei</p></message-content></model-response>
        </div>
      </infinite-scroller>`;

    const gemini = hostedGenericAdapters.find((adapter) => adapter.id === "gemini")!;
    const conversation = await gemini.extract(document);
    expect(conversation.messages.map((m) => m.metadata.providerMessageId)).toEqual([
      "a56f817d6155b853:user",
      "a56f817d6155b853:assistant",
      "e64647bbbcd34557:user",
      "e64647bbbcd34557:assistant"
    ]);
    expect(gemini.messageElements?.(document).map((el) => el.tagName)).toEqual([
      "USER-QUERY",
      "MODEL-RESPONSE",
      "USER-QUERY",
      "MODEL-RESPONSE"
    ]);
  });
});

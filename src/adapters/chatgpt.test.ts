import { describe, expect, it, vi } from "vitest";
import { chatGptAdapter } from "./chatgpt";

vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "0.0.0-test" }) } });

describe("chatgpt adapter activity capture", () => {
  it("captures thinking label and tool rows as summary labels", async () => {
    document.body.innerHTML = `
      <main>
        <section data-testid="conversation-turn-2" data-turn="assistant">
          <div class="select-none">
            <button type="button" aria-expanded="true">37s nachgedacht</button>
            <div class="thinking-container">
              <div class="row">Recherche zu Mikroabenteuern nahe Berlin</div>
              <div data-testid="cot-v5-tool-icon-pile"><span>22 Websites durchsucht</span></div>
            </div>
          </div>
          <div data-message-author-role="assistant">
            <div class="markdown"><p>Hier ist deine Reise.</p></div>
          </div>
        </section>
      </main>`;

    const conversation = await chatGptAdapter.extract(document);
    const activity = conversation.messages.filter((message) => message.metadata.kind === "activity");
    expect(activity).toHaveLength(1);
    const text = activity[0].content[0].type === "text" ? activity[0].content[0].text : "";
    expect(text).toContain("37s nachgedacht");
    expect(text).toContain("22 Websites durchsucht");
    expect(text).not.toContain("Recherche zu Mikroabenteuern");

    const answers = conversation.messages.filter((message) => message.metadata.kind !== "activity");
    expect(answers).toHaveLength(1);
    expect(answers[0].content[0]).toMatchObject({ type: "text", text: "Hier ist deine Reise." });
  });
});

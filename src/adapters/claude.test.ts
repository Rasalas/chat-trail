import { describe, expect, it, vi } from "vitest";
import { splitAssistantActivity } from "./claude";
import { claudeAdapter } from "./claude";
import { makeMessage } from "../testing/fixtures";

vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "0.0.0-test" }) } });

describe("splitAssistantActivity", () => {
  it("extracts thinking and tool activity lines into a separate list", () => {
    const message = makeMessage("assistant", 0, [
      {
        type: "text",
        text: "Dachte 11 s nach\n\nWeb durchsucht\n\nHier ist die Antwort mit **Fett**.\n\nZweiter Absatz."
      }
    ]);
    const { cleaned, activity } = splitAssistantActivity(message);
    expect(activity).toEqual(["Dachte 11 s nach", "Web durchsucht"]);
    expect(cleaned.content).toEqual([{ type: "text", text: "Hier ist die Antwort mit **Fett**.\n\nZweiter Absatz." }]);
  });

  it("moves artifact chips with their title", () => {
    const message = makeMessage("assistant", 0, [
      { type: "text", text: "Vorher.\n\n19 sortierwerk build spec\n\nDokument · MD\n\nNachher." }
    ]);
    const { cleaned, activity } = splitAssistantActivity(message);
    expect(activity).toEqual(["Artefakt: 19 sortierwerk build spec"]);
    expect(cleaned.content).toEqual([{ type: "text", text: "Vorher.\n\nNachher." }]);
  });

  it("keeps regular sentences untouched", () => {
    const message = makeMessage("assistant", 0, [
      { type: "text", text: "Ich habe das Web durchsucht und vieles gefunden." }
    ]);
    const { cleaned, activity } = splitAssistantActivity(message);
    expect(activity).toEqual([]);
    expect(cleaned.content).toHaveLength(1);
  });

  it("collects tool pills and artifacts exactly once per turn", async () => {
    document.body.innerHTML = `
      <div data-testid="transcript-row" data-perf-row="assistant">
        <h2 class="sr-only">Claude hat geantwortet: Spec</h2>
        <div class="font-claude-response">
          <button type="button" data-testid="tool-status-pill"><span class="truncate font-base">Datei erstellt, datei lesen</span></button>
          <div class="standard-markdown"><p>Antworttext</p></div>
          <div class="group/artifact-block relative flex">
            <button type="button" aria-label="19 spec anzeigen"></button>
            <div class="artifact-block-cell">
              <div class="leading-tight text-sm line-clamp-1">19 spec</div>
              <div class="text-xs line-clamp-1">Dokument<span> · </span>MD&nbsp;</div>
            </div>
          </div>
        </div>
      </div>`;

    const conversation = await claudeAdapter.extract(document);
    const activity = conversation.messages.filter((message) => message.metadata.kind === "activity");
    const text = activity
      .map((message) => (message.content[0].type === "text" ? message.content[0].text : ""))
      .join("\n");
    expect(text.split("Artefakt: 19 spec").length - 1).toBe(1);
    expect(text.split("Datei erstellt, datei lesen").length - 1).toBe(1);

    const answers = conversation.messages.filter((message) => message.metadata.kind !== "activity");
    const answerText = answers
      .map((message) => (message.content[0].type === "text" ? message.content[0].text : ""))
      .join("\n");
    expect(answerText).toContain("Antworttext");
    expect(answerText).not.toContain("Artefakt");
    expect(answerText).not.toContain("Claude hat geantwortet");
  });
});

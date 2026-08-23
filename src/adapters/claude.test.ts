import { describe, expect, it } from "vitest";
import { splitAssistantActivity } from "./claude";
import { makeMessage } from "../testing/fixtures";

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
});

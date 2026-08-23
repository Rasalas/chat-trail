import { describe, expect, it } from "vitest";
import { exportJson } from "./json";
import { makeConversation, makeMessage } from "../testing/fixtures";

describe("exportJson", () => {
  it("follows the openai-style message shape", () => {
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "Frage" }]),
      makeMessage("assistant", 1, [
        { type: "text", text: "Antwort mit **Fett**." },
        { type: "code", language: "js", text: "x()" }
      ])
    ]);
    const parsed = JSON.parse(exportJson(conversation));
    expect(parsed.messages).toEqual([
      { role: "user", content: "Frage" },
      { role: "assistant", content: "Antwort mit **Fett**.\n\n```js\nx()\n```" }
    ]);
  });

  it("keeps source metadata on top level", () => {
    const parsed = JSON.parse(exportJson(makeConversation([])));
    expect(parsed).toMatchObject({
      title: "Test Chat",
      provider: "generic",
      url: "https://example.com/chat?ref=x",
      captured_at: "2026-01-01T00:00:00.000Z",
      message_count: 0
    });
  });
});

import { describe, expect, it } from "vitest";
import { applyExportOptions } from "./filter";
import { makeConversation, makeMessage } from "../testing/fixtures";
import { DEFAULT_EXPORT_OPTIONS } from "../shared/types";

function optionsWith(overrides: Partial<typeof DEFAULT_EXPORT_OPTIONS>) {
  return { ...DEFAULT_EXPORT_OPTIONS, ...overrides };
}

describe("applyExportOptions", () => {
  it("drops user messages when includeUser is off", () => {
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "question" }]),
      makeMessage("assistant", 1, [{ type: "text", text: "answer" }])
    ]);
    const filtered = applyExportOptions(conversation, optionsWith({ includeUser: false }));
    expect(filtered.messages.map((message) => message.role)).toEqual(["assistant"]);
  });

  it("removes code blocks and then empty messages", () => {
    const conversation = makeConversation([
      makeMessage("assistant", 0, [{ type: "code", text: "x()" }]),
      makeMessage("assistant", 1, [{ type: "text", text: "kept" }, { type: "code", text: "y()" }])
    ]);
    const filtered = applyExportOptions(conversation, optionsWith({ includeCode: false }));
    expect(filtered.messages).toHaveLength(1);
    expect(filtered.messages[0].content).toEqual([{ type: "text", text: "kept" }]);
  });

  it("redacts secrets in text blocks", () => {
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "password=hunter2000" }])
    ]);
    const filtered = applyExportOptions(conversation, optionsWith({ redactSecrets: true }));
    expect(filtered.messages[0].content[0]).toEqual({ type: "text", text: "password=[redacted-secret]" });
  });

  it("anonymizes the source url", () => {
    const filtered = applyExportOptions(makeConversation([]), optionsWith({ anonymizeUrl: true }));
    expect(filtered.source.url).toBe("https://example.com/chat");
  });

  it("clears metadata when includeMetadata is off", () => {
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "hi" }])
    ]);
    conversation.messages[0].metadata.model = "test-model";
    const filtered = applyExportOptions(conversation, optionsWith({ includeMetadata: false }));
    expect(filtered.messages[0].metadata).toEqual({});
    expect(filtered.source.model).toBeUndefined();
  });
});

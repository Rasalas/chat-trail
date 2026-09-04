import { describe, expect, it } from "vitest";
import { applyExportOptions } from "./filter";
import { makeConversation, makeMessage } from "../testing/fixtures";
import { DEFAULT_EXPORT_OPTIONS } from "../shared/types";

function optionsWith(overrides: Partial<typeof DEFAULT_EXPORT_OPTIONS>) {
  return { ...DEFAULT_EXPORT_OPTIONS, ...overrides };
}

describe("applyExportOptions", () => {
  it("keeps document sections with metadata and interim replies disabled", () => {
    const conversation = makeConversation([0, 1, 2].map((index) => {
      const message = makeMessage("assistant", index, [{ type: "text", text: `Section ${index}` }]);
      message.kind = "document";
      return message;
    }));
    const filtered = applyExportOptions(conversation, optionsWith({ includeMetadata: false, collapseIntermediate: false }));
    expect(texts(filtered)).toEqual(["Section 0", "Section 1", "Section 2"]);
  });
  it("drops image blocks when includeImages is off", () => {
    const conversation = makeConversation([
      makeMessage("assistant", 0, [
        { type: "text", text: "kept" },
        { type: "image", src: "https://example.com/x.png", filename: "x.png" }
      ])
    ]);
    const filtered = applyExportOptions(conversation, optionsWith({ includeImages: false }));
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

  it("drops interim assistant messages when collapseIntermediate is off", () => {
    const conversation = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "q" }]),
      makeMessage("assistant", 1, [{ type: "text", text: "interim" }]),
      makeMessage("assistant", 2, [{ type: "text", text: "final" }]),
      makeMessage("user", 3, [{ type: "text", text: "next" }]),
      makeMessage("assistant", 4, [{ type: "text", text: "answer two" }])
    ]);
    const filtered = applyExportOptions(conversation, optionsWith({ collapseIntermediate: false }));
    expect(texts(filtered)).toEqual(["q", "final", "next", "answer two"]);
  });

  it("keeps interim assistant messages when collapseIntermediate is on", () => {
    const conversation = makeConversation([
      makeMessage("assistant", 0, [{ type: "text", text: "interim" }]),
      makeMessage("assistant", 1, [{ type: "text", text: "final" }])
    ]);
    const filtered = applyExportOptions(conversation, optionsWith({ collapseIntermediate: true }));
    expect(texts(filtered)).toEqual(["interim", "final"]);
  });
});

function texts(conversation: ReturnType<typeof applyExportOptions>): string[] {
  return conversation.messages.map((message) =>
    message.content.map((block) => (block.type === "text" ? block.text : "")).join("")
  );
}

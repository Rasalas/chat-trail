import { ChatMessage, ConversationExport, ContentBlock } from "../shared/types";

export function makeMessage(role: ChatMessage["role"], index: number, blocks: ContentBlock[]): ChatMessage {
  return {
    id: `${role}-${index + 1}`,
    role,
    content: blocks,
    metadata: { index }
  };
}

export function makeConversation(messages: ChatMessage[]): ConversationExport {
  return {
    schema_version: "1.0",
    source: {
      provider: "generic",
      url: "https://example.com/chat?ref=x",
      title: "Test Chat",
      captured_at: "2026-01-01T00:00:00.000Z"
    },
    messages,
    artifacts: [],
    manifest: { extension_version: "0.0.0-test", hashes: {} }
  };
}

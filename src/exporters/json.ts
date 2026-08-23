import { ConversationExport } from "../shared/types";
import { contentToMarkdown } from "../shared/markdown";

export function exportJson(conversation: ConversationExport): string {
  return JSON.stringify(
    {
      title: conversation.source.title,
      provider: conversation.source.provider,
      model: conversation.source.model,
      url: conversation.source.url,
      captured_at: conversation.source.captured_at,
      extension_version: conversation.manifest.extension_version,
      message_count: conversation.messages.length,
      messages: conversation.messages.map((message) => ({
        role: message.role,
        content: contentToMarkdown(message.content)
      }))
    },
    null,
    2
  );
}

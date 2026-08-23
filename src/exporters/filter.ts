import { ChatMessage, ContentBlock, ConversationExport, ExportOptions } from "../shared/types";
import { normalizeUrlForPrivacy } from "../shared/strings";
import { redactText } from "../shared/redaction";
import { intermediateAssistantFlags } from "./turns";

export function applyExportOptions(conversation: ConversationExport, options: ExportOptions): ConversationExport {
  const filtered: ConversationExport = structuredClone(conversation);
  filtered.source.url = options.anonymizeUrl ? normalizeUrlForPrivacy(filtered.source.url) : filtered.source.url;
  filtered.messages = filtered.messages
    .filter((message) => {
      if (message.role === "user") return options.includeUser;
      if (message.role === "assistant") return options.includeAssistant;
      return true;
    })
    .map((message) => filterMessage(message, options))
    .filter((message) => message.content.length > 0);

  if (!options.includeMetadata) {
    filtered.messages = filtered.messages.map((message) => ({ ...message, metadata: {} }));
    filtered.source.model = undefined;
  }

  if (!options.collapseIntermediate) {
    const interim = intermediateAssistantFlags(filtered.messages);
    filtered.messages = filtered.messages.filter((_, index) => !interim[index]);
  }

  return filtered;
}

function filterMessage(message: ChatMessage, options: ExportOptions): ChatMessage {
  return {
    ...message,
    content: message.content
      .filter((block) => includeBlock(block, options))
      .map((block) => (options.redactSecrets ? redactBlock(block) : block))
  };
}

function includeBlock(block: ContentBlock, options: ExportOptions): boolean {
  if (block.type === "code") return options.includeCode;
  if (block.type === "table") return options.includeTables;
  if (block.type === "quote") return options.includeCitations;
  if (block.type === "image") return options.includeImages;
  return true;
}

function redactBlock(block: ContentBlock): ContentBlock {
  if (block.type === "text" || block.type === "code" || block.type === "quote") {
    return { ...block, text: redactText(block.text) };
  }
  if (block.type === "table") return { ...block, markdown: redactText(block.markdown) };
  return { ...block, alt: block.alt ? redactText(block.alt) : undefined, filename: block.filename ? redactText(block.filename) : undefined };
}

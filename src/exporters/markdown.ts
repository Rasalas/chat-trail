import { ConversationExport, ContentBlock } from "../shared/types";

export function exportMarkdown(conversation: ConversationExport): string {
  const lines: string[] = [...frontmatter(conversation), `# ${conversation.source.title || "Chat Export"}`, ""];

  for (const [index, message] of conversation.messages.entries()) {
    lines.push(`## ${index + 1}. ${labelForRole(message.role)}`);
    const metadata = messageMetadata(message);
    if (metadata.length > 0) lines.push(`_${metadata.join(" | ")}_`, "");
    for (const block of message.content) {
      lines.push(renderBlock(block), "");
    }
  }

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}

function frontmatter(conversation: ConversationExport): string[] {
  const fields = [
    ["schema_version", conversation.schema_version],
    ["provider", conversation.source.provider],
    ["title", conversation.source.title],
    ["url", conversation.source.url],
    ["captured_at", conversation.source.captured_at],
    ["model", conversation.source.model],
    ["message_count", String(conversation.messages.length)],
    ["extension_version", conversation.manifest.extension_version]
  ].filter(([, value]) => value != null && value !== "");

  return [
    "---",
    ...fields.map(([key, value]) => `${key}: ${yamlString(String(value))}`),
    "---",
    ""
  ];
}

function labelForRole(role: string): string {
  if (role === "user") return "User";
  if (role === "assistant") return "Assistant";
  if (role === "system") return "System";
  return "Unknown";
}

function messageMetadata(message: ConversationExport["messages"][number]): string[] {
  return [
    message.metadata.timestamp ? `time: ${message.metadata.timestamp}` : undefined,
    message.metadata.model ? `model: ${message.metadata.model}` : undefined
  ].filter(Boolean) as string[];
}

function renderBlock(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "code":
      return `\`\`\`${block.language ?? ""}\n${block.text}\n\`\`\``;
    case "table":
      return block.markdown;
    case "quote":
      return `> ${block.text.replace(/\n/g, "\n> ")}`;
    case "image":
      return `![${block.alt ?? block.filename ?? "image"}](${block.src ?? block.filename ?? ""})`;
    case "link":
      return `[${block.text}](${block.url})`;
  }
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

import { ChatMessage, ConversationExport, ContentBlock } from "../shared/types";
import { intermediateAssistantFlags } from "./turns";

const LABEL_MAX_LENGTH = 80;

export function exportMarkdown(conversation: ConversationExport): string {
  const lines: string[] = [
    ...frontmatter(conversation),
    `# ${conversation.source.title || "Chat Export"}`,
    ""
  ];

  const interim = intermediateAssistantFlags(conversation.messages);
  let collapsed: ChatMessage[] = [];

  const flushCollapsed = (): void => {
    if (collapsed.length === 0) return;

    const labels: string[] = [];
    const others: ChatMessage[] = [];
    collapsed.forEach((message) => {
      if (message.metadata.kind !== "activity") {
        others.push(message);
        return;
      }
      renderMessageBody(message)
        .split("\n")
        .map(compactLine)
        .filter((line) => line.length > 0 && line.length <= LABEL_MAX_LENGTH)
        .forEach((line) => {
          if (!labels.includes(line)) labels.push(line);
        });
    });

    const shownLabels = labels.slice(0, 4);
    if (labels.length > 4) shownLabels.push(`+${labels.length - 4}`);
    let summary = shownLabels.join(" · ");
    if (others.length > 0) {
      const suffix = `${others.length} previous message${others.length === 1 ? "" : "s"}`;
      summary = summary ? `${summary} · ${suffix}` : suffix;
    }

    if (others.length === 0 && labels.length > 0) {
      lines.push(`_${escapeHtml(summary)}_`, "");
      collapsed = [];
      return;
    }

    lines.push(`<details><summary>${escapeHtml(summary)}</summary>`, "");
    collapsed.forEach((message) => {
      if (message.metadata.kind === "activity") return;
      const body = renderMessageBody(message);
      if (body) lines.push(body, "");
    });
    lines.push("</details>", "");
    collapsed = [];
  };

  conversation.messages.forEach((message, index) => {
    if (interim[index]) {
      const body = renderMessageBody(message);
      if (body) collapsed.push(message);
      return;
    }

    flushCollapsed();
    const body = renderMessageBody(message);
    if (!body) return;
    lines.push(message.role === "assistant" ? body : quoteText(body), "");
  });
  flushCollapsed();

  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trimEnd() + "\n";
}

function compactLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

  return ["---", ...fields.map(([key, value]) => `${key}: ${JSON.stringify(String(value))}`), "---", ""];
}

function renderMessageBody(message: ConversationExport["messages"][number]): string {
  return message.content.map(renderBlock).join("\n\n");
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
      return quoteText(block.text, "> >");
    case "image":
      return `![${block.alt ?? block.filename ?? "image"}](${block.src ?? block.filename ?? ""})`;
  }
}

function quoteText(text: string, prefix = ">"): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? prefix : `${prefix} ${line}`))
    .join("\n");
}

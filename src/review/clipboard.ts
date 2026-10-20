import { sha256Hex, stableId } from "../shared/hash";
import { ChatMessage, ConversationExport } from "../shared/types";

export async function conversationFromClipboard(text: string): Promise<ConversationExport> {
  const chunks = splitClipboardMessages(text);
  const messages: ChatMessage[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const role = inferClipboardRole(chunk.role, index);
    const body = chunk.text.trim();
    messages.push({
      id: `${role}-${index}-${stableId(role, body)}`,
      role,
      content: [{ type: "text", text: body }],
      metadata: {
        index,
        visibleTextHash: await sha256Hex(body)
      }
    });
  }

  return {
    schema_version: "1.0",
    source: {
      provider: "clipboard",
      url: "",
      title: "Clipboard Chat",
      captured_at: new Date().toISOString()
    },
    messages,
    artifacts: [],
    manifest: {
      extension_version: chrome.runtime.getManifest().version,
      hashes: {}
    }
  };
}

function splitClipboardMessages(text: string): Array<{ role?: string; text: string }> {
  const blocks = text
    .split(/\n(?=(?:user|you|human|assistant|chatgpt|claude|ai)\s*:)/gi)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length > 1) {
    return blocks.map((block) => {
      const match = block.match(/^([^:\n]{1,24})\s*:\s*([\s\S]*)$/);
      return match ? { role: match[1], text: match[2] } : { text: block };
    });
  }

  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => ({ text: block }));
}

function inferClipboardRole(role: string | undefined, index: number): ChatMessage["role"] {
  const value = role?.toLowerCase() ?? "";
  if (/user|you|human/.test(value)) return "user";
  if (/assistant|chatgpt|claude|ai/.test(value)) return "assistant";
  return index % 2 === 0 ? "user" : "assistant";
}

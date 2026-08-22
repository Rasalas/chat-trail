import { ChatAdapter } from "../shared/types";
import { enhanceMessageWithProviderCopy } from "../normalizer/copy-enhancement";
import { createBaseConversation, elementToMessage, inferRole, selectorFor, uniqueElements } from "../normalizer/dom";

export const claudeAdapter: ChatAdapter = {
  id: "claude",
  label: "Claude",
  capabilities: {
    modelName: true,
    timestamps: false,
    citations: true,
    artifacts: true,
    attachments: true
  },
  matches(url, document) {
    return /(^|\.)claude\.ai$/.test(url.hostname) || /claude/i.test(document.title);
  },
  async extract(document) {
    const conversation = createBaseConversation("claude", document);
    const model = findVisibleModel(document);
    if (model) conversation.source.model = model;

    const elements = uniqueElements([
      "[data-testid*='message' i]",
      "[class*='font-user-message']",
      "[class*='group'][data-is-streaming]",
      "main article",
      "main [role='listitem']"
    ]);

    const filtered = elements.filter((element) => {
      const text = element.textContent?.trim() ?? "";
      return text.length > 0 && !/^(copy|retry|edit|thumbs)/i.test(text);
    });

    const messages = [];
    for (const [index, element] of filtered.entries()) {
      const role = inferClaudeRole(element, index);
      const message = await elementToMessage(element, role, index, selectorFor(element));
      if (message) {
        message.metadata.model = role === "assistant" ? model : undefined;
        messages.push(await enhanceMessageWithProviderCopy(message, element));
      }
    }

    conversation.messages = messages;
    return conversation;
  }
};

function inferClaudeRole(element: Element, index: number) {
  const marker = `${element.getAttribute("data-testid") ?? ""} ${element.className}`.toLowerCase();
  if (marker.includes("user") || marker.includes("human")) return "user" as const;
  if (marker.includes("assistant") || marker.includes("claude")) return "assistant" as const;
  return inferRole(element, index);
}

function findVisibleModel(document: Document): string | undefined {
  const text = [...document.querySelectorAll("button, [aria-label]")]
    .map((node) => node.textContent?.trim())
    .find((value) => value && /claude|sonnet|opus|haiku/i.test(value));
  return text?.replace(/\s+/g, " ");
}

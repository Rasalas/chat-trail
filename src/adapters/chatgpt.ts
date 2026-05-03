import { ChatAdapter, ChatMessage } from "../shared/types";
import { createBaseConversation, elementToMessage, uniqueElements } from "../normalizer/dom";

export const chatGptAdapter: ChatAdapter = {
  id: "chatgpt",
  label: "ChatGPT",
  capabilities: {
    modelName: true,
    timestamps: false,
    citations: true,
    artifacts: true,
    attachments: true
  },
  matches(url, document) {
    return /(^|\.)chatgpt\.com$/.test(url.hostname) || Boolean(document.querySelector("[data-message-author-role]"));
  },
  async extract(document) {
    const conversation = createBaseConversation("chatgpt", document);
    const model = findVisibleModel(document);
    if (model) conversation.source.model = model;

    const roleElements = uniqueElements(["[data-message-author-role='user']", "[data-message-author-role='assistant']"]);
    const elements = roleElements.length >= 2 ? roleElements : uniqueElements(["[data-testid^='conversation-turn']"]);

    const messages: ChatMessage[] = [];
    for (const [index, element] of elements.entries()) {
      const explicitRole = element.getAttribute("data-message-author-role");
      const role = explicitRole === "user" || explicitRole === "assistant" ? explicitRole : roleFromTurn(element, index);
      const messageRoot =
        element.querySelector("[data-message-author-role], .markdown, [data-testid='message-content']") ?? element;
      const message = await elementToMessage(messageRoot, role, index, selectorFor(element));
      if (message) {
        message.metadata.model = role === "assistant" ? model : undefined;
        messages.push(message);
      }
    }

    conversation.messages = messages;
    return conversation;
  }
};

function roleFromTurn(element: Element, index: number): ChatMessage["role"] {
  const roleNode = element.querySelector("[data-message-author-role]");
  const role = roleNode?.getAttribute("data-message-author-role");
  if (role === "user" || role === "assistant") return role;
  return index % 2 === 0 ? "user" : "assistant";
}

function findVisibleModel(document: Document): string | undefined {
  const candidates = [
    "[data-testid='model-switcher-dropdown-button']",
    "button[aria-label*='model' i]",
    "header button",
    "main [aria-label*='model' i]"
  ];

  for (const selector of candidates) {
    const text = document.querySelector(selector)?.textContent?.trim();
    if (text && /gpt|o\d|model/i.test(text)) return text.replace(/\s+/g, " ");
  }
  return undefined;
}

function selectorFor(element: Element): string {
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  const role = element.getAttribute("data-message-author-role");
  if (role) return `[data-message-author-role="${CSS.escape(role)}"]`;
  return element.tagName.toLowerCase();
}

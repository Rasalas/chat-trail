import { ChatAdapter, ChatMessage } from "../shared/types";
import { compactWhitespace } from "../shared/strings";
import { stableId } from "../shared/hash";
import { createBaseConversation, elementToMessage, selectorFor, uniqueElements } from "../normalizer/dom";
import { enhanceMessageWithProviderCopy } from "../normalizer/copy-enhancement";

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

    const turns = uniqueElements(["[data-testid^='conversation-turn']"]);
    const useTurns =
      turns.length >= 2 || (turns.length === 1 && turns[0].querySelector("[data-message-author-role]"));

    const messages: ChatMessage[] = [];

    if (useTurns) {
      for (const [index, turn] of turns.entries()) {
        const inner = turn.querySelector("[data-message-author-role]");
        const explicitRole = inner?.getAttribute("data-message-author-role");
        const role =
          explicitRole === "user" || explicitRole === "assistant" ? explicitRole : roleFromTurn(turn, index);

        if (role === "assistant") {
          const activity = collectActivity(turn);
          if (activity.length > 0) {
            messages.push({
              id: stableId("assistant-activity", activity.join("\n")),
              role: "assistant",
              content: [{ type: "text", text: activity.join("\n") }],
              metadata: {
                index,
                selector: "[data-testid='cot-v5-tool-icon-pile'], button[aria-expanded]",
                kind: "activity"
              }
            });
          }
        }

        const messageRoot = inner ?? turn.querySelector(".markdown, [data-testid='message-content']") ?? turn;
        const message = await elementToMessage(messageRoot, role, index, selectorFor(turn));
        if (message) {
          message.metadata.model = role === "assistant" ? model : undefined;
          messages.push(await enhanceMessageWithProviderCopy(message, turn));
        }
      }
    } else {
      const roleElements = uniqueElements(["[data-message-author-role='user']", "[data-message-author-role='assistant']"]);
      for (const [index, element] of roleElements.entries()) {
        const explicitRole = element.getAttribute("data-message-author-role");
        const role = explicitRole === "user" || explicitRole === "assistant" ? explicitRole : roleFromTurn(element, index);
        const messageRoot =
          element.querySelector("[data-message-author-role], .markdown, [data-testid='message-content']") ?? element;
        const message = await elementToMessage(messageRoot, role, index, selectorFor(element));
        if (message) {
          message.metadata.model = role === "assistant" ? model : undefined;
          messages.push(await enhanceMessageWithProviderCopy(message, element));
        }
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

function collectActivity(turn: Element): string[] {
  const items: string[] = [];

  for (const toggle of turn.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")) {
    const label = compactWhitespace(toggle.textContent ?? "");
    if (/nachgedacht|thought/i.test(label)) items.push(label);
  }

  for (const pile of turn.querySelectorAll("[data-testid='cot-v5-tool-icon-pile']")) {
    const label = compactWhitespace(pile.textContent ?? "").replace(/\s*\+\d+$/, "");
    if (label) items.push(label);
  }

  return items;
}

function findVisibleModel(document: Document): string | undefined {
  const slug = document.querySelector("[data-message-model-slug]")?.getAttribute("data-message-model-slug");
  if (slug) return slug;

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

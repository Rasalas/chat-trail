import { ChatAdapter } from "../shared/types";
import { createBaseConversation, elementToMessage, inferRole, selectorFor, uniqueElements } from "../normalizer/dom";
import { compactWhitespace } from "../shared/strings";

export const genericAdapter: ChatAdapter = {
  id: "generic",
  label: "Generic Web Chat",
  capabilities: {
    modelName: false,
    timestamps: true,
    citations: true,
    artifacts: false,
    attachments: true
  },
  matches() {
    return true;
  },
  async extract(document) {
    const conversation = createBaseConversation("generic", document);
    const root = findLikelyChatRoot(document);
    const messageElements = findLikelyMessages(root);
    const messages = [];

    for (const [index, element] of messageElements.entries()) {
      const message = await elementToMessage(element, inferRole(element, index), index, selectorFor(element));
      if (message) messages.push(message);
    }

    conversation.messages = messages;
    return conversation;
  }
};

export async function extractFromContainer(container: Element, document: Document) {
  const conversation = createBaseConversation("generic", document);
  const messageElements = findLikelyMessages(container);
  const messages = [];

  for (const [index, element] of messageElements.entries()) {
    const message = await elementToMessage(element, inferRole(element, index), index, selectorFor(element));
    if (message) messages.push(message);
  }

  conversation.messages = messages;
  return conversation;
}

function findLikelyChatRoot(document: Document): Element {
  const roots = uniqueElements(["main", "[role='main']", "[class*='chat' i]", "[class*='conversation' i]", "body"]);
  return roots
    .map((element) => ({ element, score: scoreChatRoot(element) }))
    .sort((a, b) => b.score - a.score)[0]?.element ?? document.body;
}

function findLikelyMessages(root: ParentNode): Element[] {
  const direct = uniqueElements(
    [
      "article",
      "[role='listitem']",
      "[data-message-id]",
      "[class*='message' i]",
      "[class*='chat-message' i]",
      "[class*='response' i]"
    ],
    root
  ).filter(isLikelyMessage);

  if (direct.length >= 2) return removeNestedDuplicates(direct);

  const blocks = [...root.querySelectorAll("p, li, pre, blockquote, section, div")]
    .filter(isLikelyMessage)
    .filter((element) => compactWhitespace(element.textContent ?? "").length > 24);

  return removeNestedDuplicates(blocks).slice(0, 80);
}

function scoreChatRoot(element: Element): number {
  const text = compactWhitespace(element.textContent ?? "");
  const messages = element.querySelectorAll("article, [role='listitem'], [class*='message' i], pre").length;
  const roleWords = (text.match(/\b(user|assistant|you|human|ai|chatgpt|claude)\b/gi) ?? []).length;
  return messages * 4 + roleWords + Math.min(text.length / 1000, 20);
}

function isLikelyMessage(element: Element): boolean {
  const text = compactWhitespace(element.textContent ?? "");
  if (text.length < 2) return false;
  if (element.matches("nav, header, footer, aside, form, input, textarea, button")) return false;
  if (text.length < 16 && !element.querySelector("pre, code, table, img")) return false;
  const interactive = element.querySelectorAll("button, input, textarea, select").length;
  return interactive < 8;
}

function removeNestedDuplicates(elements: Element[]): Element[] {
  return elements.filter((element, index) => {
    return !elements.some((other, otherIndex) => otherIndex !== index && other.contains(element));
  });
}

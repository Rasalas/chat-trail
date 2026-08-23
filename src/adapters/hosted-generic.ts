import { ChatAdapter, ChatMessage, ProviderId } from "../shared/types";
import {
  createBaseConversation,
  dropContained,
  elementToMessage,
  inferRole,
  selectorFor,
  uniqueElements
} from "../normalizer/dom";

interface HostedMessageSelector {
  selector: string;
  role: "user" | "assistant";
}

interface HostedProvider {
  id: ProviderId;
  label: string;
  hosts: RegExp[];
  modelPattern?: RegExp;
  messages?: HostedMessageSelector[];
}

const providers: HostedProvider[] = [
  {
    id: "gemini",
    label: "Gemini",
    hosts: [/(^|\.)gemini\.google\.com$/],
    modelPattern: /gemini|pro|flash/i,
    messages: [
      { selector: "user-query", role: "user" },
      { selector: "model-response", role: "assistant" }
    ]
  },
  { id: "perplexity", label: "Perplexity", hosts: [/(^|\.)perplexity\.ai$/], modelPattern: /sonar|perplexity|gpt|claude/i },
  { id: "copilot", label: "Copilot", hosts: [/(^|\.)copilot\.microsoft\.com$/, /(^|\.)bing\.com$/], modelPattern: /copilot|gpt/i },
  { id: "poe", label: "Poe", hosts: [/(^|\.)poe\.com$/], modelPattern: /claude|gpt|gemini|llama|mistral/i },
  { id: "huggingchat", label: "HuggingChat", hosts: [/(^|\.)huggingface\.co$/], modelPattern: /llama|mistral|qwen|deepseek/i },
  { id: "mistral", label: "Mistral Le Chat", hosts: [/(^|\.)chat\.mistral\.ai$/], modelPattern: /mistral|codestral|magistral/i }
];

export const hostedGenericAdapters: ChatAdapter[] = providers.map((provider) => ({
  id: provider.id,
  label: provider.label,
  capabilities: {
    modelName: true,
    timestamps: true,
    citations: true,
    artifacts: false,
    attachments: true
  },
  matches(url) {
    return provider.hosts.some((host) => host.test(url.hostname));
  },
  async extract(document) {
    const conversation = createBaseConversation(provider.id, document);
    const model = findModel(document, provider.modelPattern);
    if (model) conversation.source.model = model;

    const messages: ChatMessage[] = [];

    if (provider.messages) {
      const tagged = provider.messages.flatMap(({ selector, role }) =>
        [...document.querySelectorAll(selector)].map((element) => ({ element, role }))
      );
      const seen = new Set<Element>();
      tagged.sort((a, b) => {
        if (a.element === b.element) return 0;
        return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
      });

      for (const [index, { element, role }] of tagged.entries()) {
        if (seen.has(element)) continue;
        seen.add(element);
        const message = await elementToMessage(element, role, index, selectorFor(element));
        if (!message) continue;
        if (role === "assistant") message.metadata.model = model;
        messages.push(message);
      }
    } else {
      const elements = dropContained(
        uniqueElements([
          "[data-testid*='message' i]",
          "[data-message-id]",
          "main article",
          "main [role='listitem']",
          "[class*='message' i]",
          "[class*='conversation' i] article"
        ])
      );

      for (const [index, element] of elements.entries()) {
        const message = await elementToMessage(element, inferRole(element, index), index, selectorFor(element));
        if (!message) continue;
        if (message.role === "assistant") message.metadata.model = model;
        messages.push(message);
      }
    }

    conversation.messages = messages;
    return conversation;
  }
}));

function findModel(document: Document, pattern?: RegExp): string | undefined {
  if (!pattern) return undefined;

  const modeButton = document.querySelector<HTMLButtonElement>("[data-test-id='bard-mode-menu-button']");
  const modeMatch = (modeButton?.getAttribute("aria-label") ?? "").match(/:\s*([A-Za-z0-9._-]+)\s*$/);
  if (modeMatch && pattern.test(modeMatch[1])) return modeMatch[1];

  return [...document.querySelectorAll("button, [aria-label], header, nav")]
    .map((node) => node.textContent?.trim().replace(/\s+/g, " "))
    .find((text) => text && text.length < 80 && pattern.test(text));
}

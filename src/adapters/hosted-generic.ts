import { ChatAdapter, ProviderId } from "../shared/types";
import { createBaseConversation, elementToMessage, inferRole, uniqueElements } from "../normalizer/dom";

interface HostedProvider {
  id: ProviderId;
  label: string;
  hosts: RegExp[];
  modelPattern?: RegExp;
}

const providers: HostedProvider[] = [
  { id: "gemini", label: "Gemini", hosts: [/(^|\.)gemini\.google\.com$/], modelPattern: /gemini|pro|flash/i },
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

    const elements = uniqueElements([
      "[data-testid*='message' i]",
      "[data-message-id]",
      "main article",
      "main [role='listitem']",
      "[class*='message' i]",
      "[class*='conversation' i] article"
    ]);

    const messages = [];
    for (const [index, element] of elements.entries()) {
      const message = await elementToMessage(element, inferRole(element, index), index, selectorFor(element));
      if (message) {
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
  return [...document.querySelectorAll("button, [aria-label], header, nav")]
    .map((node) => node.textContent?.trim().replace(/\s+/g, " "))
    .find((text) => text && text.length < 80 && pattern.test(text));
}

function selectorFor(element: Element): string {
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  const id = element.id ? `#${CSS.escape(element.id)}` : "";
  return id || element.tagName.toLowerCase();
}

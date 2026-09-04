import { ChatAdapter, ChatMessage, ContentBlock } from "../shared/types";
import { compactWhitespace } from "../shared/strings";
import { stableId } from "../shared/hash";
import { enhanceMessageWithProviderCopy } from "../normalizer/copy-enhancement";
import { createBaseConversation, dropContained, elementToMessage, inferRole, selectorFor, uniqueElements } from "../normalizer/dom";

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

    const rows = uniqueElements(["[data-testid='transcript-row']"]);
    const messages: ChatMessage[] = [];

    if (rows.length > 0) {
      for (const [index, row] of rows.entries()) {
        const perfRole = row.getAttribute("data-perf-row");
        const role: ChatMessage["role"] =
          perfRole === "human" ? "user" : perfRole === "assistant" ? "assistant" : inferClaudeRole(row, index);

        // Virtualised transcript: data-index is the row's stable position in the conversation.
        const providerMessageId = row.getAttribute("data-index") ?? row.getAttribute("data-rs-index") ?? undefined;
        const activity: string[] = [];
        const body = prepareBody(row, activity);
        const root = body.querySelector("[data-testid='user-message'], .font-claude-response") ?? body;

        let message = await elementToMessage(root, role, index, selectorFor(row));
        if (!message) continue;

        if (role === "assistant") {
          const split = splitAssistantActivity(message);
          message = split.cleaned;
          activity.push(...split.activity);
          if (activity.length > 0) {
            messages.push({
              id: stableId("claude-activity", activity.join("\n")),
              role: "assistant",
              kind: "activity",
              content: [{ type: "text", text: activity.join("\n") }],
              metadata: { index, selector: "[data-testid='tool-status-pill']", providerMessageId }
            });
          }
          if (!split.cleaned.content.length) continue;
        }

        message.metadata.model = role === "assistant" ? model : undefined;
        message.metadata.providerMessageId = providerMessageId;
        messages.push(await enhanceMessageWithProviderCopy(message, row));
      }
    } else {
      await extractLegacy(document, conversation, messages, model);
    }

    conversation.messages = messages;
    return conversation;
  },
  messageElements(document) {
    return [...document.querySelectorAll("[data-testid='transcript-row']")];
  }
};

async function extractLegacy(
  document: Document,
  conversation: ReturnType<typeof createBaseConversation>,
  messages: ChatMessage[],
  model: string | undefined
): Promise<void> {
  const selected = dropContained(
    uniqueElements([
      "[data-testid='user-message']",
      "[data-testid='assistant-message']",
      "[data-testid='assistant-response']",
      "[class*='font-user-message']",
      "[class*='font-claude-message']",
      "main article",
      "main [role='listitem']"
    ])
  ).filter((element) => (element.textContent?.trim() ?? "").length > 0);

  for (const [index, element] of selected.entries()) {
    const role = inferClaudeRole(element, index);
    let message = await elementToMessage(element, role, index, selectorFor(element));
    if (!message) continue;

    if (role === "assistant") {
      const split = splitAssistantActivity(message);
      message = split.cleaned;
      if (split.activity.length > 0) {
        messages.push({
          id: stableId("claude-activity", split.activity.join("\n")),
          role: "assistant",
          kind: "activity",
          content: [{ type: "text", text: split.activity.join("\n") }],
          metadata: { index, selector: "activity" }
        });
      }
      if (!split.cleaned.content.length) continue;
    }

    message.metadata.model = role === "assistant" ? model : undefined;
    messages.push(await enhanceMessageWithProviderCopy(message, element));
  }
}

function prepareBody(row: Element, activity: string[]): Element {
  const clone = row.cloneNode(true) as Element;

  for (const pill of [...clone.querySelectorAll("[data-testid='tool-status-pill']")]) {
    const label = compactWhitespace(pill.textContent ?? "");
    if (label && !activity.includes(label)) activity.push(label);
    pill.remove();
  }

  for (const artifact of [...clone.querySelectorAll('[class*="artifact-block"]')]) {
    if (artifact.parentElement?.closest('[class*="artifact-block"]')) continue;
    const title = compactWhitespace(artifact.querySelector('[class*="line-clamp-1"]')?.textContent ?? "");
    const label = `Artefakt: ${title}`;
    if (title && !activity.includes(label)) activity.push(label);
    artifact.remove();
  }

  for (const promo of [...clone.querySelectorAll('[class*="rounded-2xl"][class*="shadow-sm"]')]) {
    promo.remove();
  }

  return clone;
}

function inferClaudeRole(element: Element, index: number): ChatMessage["role"] {
  const marker = `${element.getAttribute("data-testid") ?? ""} ${element.className} ${element.getAttribute("aria-label") ?? ""}`.toLowerCase();
  if (/user|human/.test(marker)) return "user" as const;
  if (/assistant|claude/.test(marker)) return "assistant" as const;
  return inferRole(element, index);
}

const ACTIVITY_LINE =
  /^(?:dachte\s+.{1,20}\s*nach|thought(?:\s+for\s+.*)?|web[- ]?durchsucht|web ?search(?:ed)?(?: the web)?|searched the web|datei (?:erstellt|gelesen|bearbeitet|angesehen)[^.]*|\d+\s+dateien? (?:bearbeitet|erstellt|angesehen)[^.]*)\.?\s*$/i;

const ARTIFACT_CHIP = /^dokument(\s*·\s*\S+)?$/i;

export function splitAssistantActivity(message: ChatMessage): { cleaned: ChatMessage; activity: string[] } {
  const cleanedContent: ContentBlock[] = [];
  const activity: string[] = [];

  for (const block of message.content) {
    if (block.type !== "text") {
      cleanedContent.push(block);
      continue;
    }

    const paragraphs = block.text.split(/\n{2,}/);
    const kept: string[] = [];

    for (let i = 0; i < paragraphs.length; i += 1) {
      const paragraph = compactWhitespace(paragraphs[i]).trim();
      const next = compactWhitespace(paragraphs[i + 1] ?? "").trim();

      if (ACTIVITY_LINE.test(paragraph)) {
        activity.push(paragraph.replace(/\.$/, ""));
        continue;
      }

      if (paragraph && ARTIFACT_CHIP.test(next)) {
        const label = `Artefakt: ${paragraph}`;
        if (!activity.includes(label)) activity.push(label);
        i += 1;
        continue;
      }

      kept.push(paragraphs[i]);
    }

    const text = kept.join("\n\n").trim();
    if (text) cleanedContent.push({ type: "text", text });
  }

  return { cleaned: { ...message, content: cleanedContent }, activity };
}

function findVisibleModel(document: Document): string | undefined {
  const dropdown = document.querySelector<HTMLButtonElement>("[data-testid='model-selector-dropdown']");
  const ariaLabel = dropdown?.getAttribute("aria-label") ?? "";
  const match = ariaLabel.match(/:\s*(.+?)\s*$/);
  if (match) return match[1];

  for (const node of document.querySelectorAll("button, [aria-label], nav")) {
    const text = compactWhitespace(node.textContent ?? "");
    if (!text || text.length > 40) continue;
    if (/\bclaude\b|\bsonnet\b|\bopus\b|\bhaiku\b/i.test(text)) return text;
  }
  return undefined;
}

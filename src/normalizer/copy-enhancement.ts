import { ChatMessage } from "../shared/types";

const COPY_BUTTON_SELECTORS = [
  "button[aria-label*='copy' i]",
  "button[data-testid*='copy' i]",
  "button[title*='copy' i]",
  "[role='button'][aria-label*='copy' i]"
];

let providerCopyEnabled = false;

export function setProviderCopyEnabled(enabled: boolean): void {
  providerCopyEnabled = enabled;
}

export async function enhanceMessageWithProviderCopy(message: ChatMessage, messageElement: Element): Promise<ChatMessage> {
  if (!providerCopyEnabled) return message;
  if (message.role !== "assistant") return message;

  const button = findMessageCopyButton(messageElement);
  if (!button) return message;

  const copiedText = await readFromCopyButton(button);
  if (!copiedText || !looksLikeFullMessage(copiedText, messageElement)) return message;

  return {
    ...message,
    content: [{ type: "text", text: copiedText }],
    metadata: {
      ...message.metadata,
      extractionMethod: "provider-copy"
    }
  };
}

function findMessageCopyButton(messageElement: Element): HTMLElement | undefined {
  const buttons = COPY_BUTTON_SELECTORS.flatMap((selector) => [...messageElement.querySelectorAll<HTMLElement>(selector)]);

  return buttons
    .filter((button) => !isCodeBlockCopyButton(button, messageElement))
    .map((button) => ({ button, score: scoreCopyButton(button, messageElement) }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.button;
}

function isCodeBlockCopyButton(button: HTMLElement, messageElement: Element): boolean {
  const pre = button.closest("pre, [class*='code' i], [data-language], .hljs");
  if (!pre || !messageElement.contains(pre)) return false;

  const codeText = pre.textContent?.trim() ?? "";
  const messageText = messageElement.textContent?.trim() ?? "";
  return codeText.length > 0 && codeText.length < Math.max(messageText.length * 0.75, 1200);
}

function scoreCopyButton(button: HTMLElement, messageElement: Element): number {
  const text = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""} ${button.textContent ?? ""}`.toLowerCase();
  if (!text.includes("copy")) return 0;

  let score = 1;
  const rect = button.getBoundingClientRect();
  const messageRect = messageElement.getBoundingClientRect();

  if (rect.top > messageRect.top && rect.bottom < messageRect.bottom) score += 1;
  if (rect.left > messageRect.left && rect.right < messageRect.right) score += 1;
  if (button.closest("pre, code")) score -= 5;
  if (button.closest("article, [data-message-author-role], [data-testid*='message' i]") === messageElement) score += 2;

  return score;
}

async function readFromCopyButton(button: HTMLElement): Promise<string | undefined> {
  if (!navigator.clipboard?.readText) return undefined;

  const previousClipboard = await safeReadClipboard();
  button.click();
  const copied = await waitForClipboardChange(previousClipboard);

  if (previousClipboard != null && copied !== previousClipboard) {
    await safeWriteClipboard(previousClipboard);
  }

  return copied;
}

async function waitForClipboardChange(previous: string | undefined): Promise<string | undefined> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await delay(120);
    const value = await safeReadClipboard();
    if (value && value !== previous) return value.trim();
  }
  return undefined;
}

async function safeReadClipboard(): Promise<string | undefined> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return undefined;
  }
}

async function safeWriteClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard restore is best effort; extraction must not fail if the browser denies it.
  }
}

function looksLikeFullMessage(copiedText: string, messageElement: Element): boolean {
  const copied = normalizeForCompare(copiedText);
  const visible = normalizeForCompare(messageElement.textContent ?? "");

  if (copied.length < 20) return false;
  if (visible.includes(copied.slice(0, Math.min(copied.length, 160)))) return true;

  const copiedWords = new Set(copied.split(" ").filter((word) => word.length > 3));
  if (copiedWords.size < 5) return false;

  const visibleWords = new Set(visible.split(" "));
  let overlap = 0;
  copiedWords.forEach((word) => {
    if (visibleWords.has(word)) overlap += 1;
  });

  return overlap / copiedWords.size > 0.45;
}

function normalizeForCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(copy|copied|retry|edit|share|like|dislike)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

import "./style.css";
import { createEvidencePack } from "../exporters/evidence";
import { applyExportOptions } from "../exporters/filter";
import { exportHtml } from "../exporters/html";
import { exportJson } from "../exporters/json";
import { exportMarkdown } from "../exporters/markdown";
import { blobFromText, downloadBlob } from "../shared/download";
import { redactText } from "../shared/redaction";
import { escapeHtml } from "../shared/strings";
import { slugify } from "../shared/strings";
import { sha256Hex, stableId } from "../shared/hash";
import { readableTabError, getActiveTabId, sendToTabWithContentScript } from "../shared/tabs";
import { withBusy } from "../shared/ui";
import { ChatMessage, ConversationExport, ContentBlock, DEFAULT_EXPORT_OPTIONS, ExportOptions, RuntimeResponse } from "../shared/types";
import { renderMarkdown } from "./markdown";

const summary = document.querySelector<HTMLElement>("#summary")!;
const messagesRoot = document.querySelector<HTMLElement>("#messages")!;
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh")!;
const markdownButton = document.querySelector<HTMLButtonElement>("#export-md")!;
const jsonButton = document.querySelector<HTMLButtonElement>("#export-json")!;
const htmlButton = document.querySelector<HTMLButtonElement>("#export-html")!;
const printButton = document.querySelector<HTMLButtonElement>("#print-pdf")!;
const zipButton = document.querySelector<HTMLButtonElement>("#export-zip")!;
const selectAllButton = document.querySelector<HTMLButtonElement>("#select-all")!;
const selectNoneButton = document.querySelector<HTMLButtonElement>("#select-none")!;
const redactButton = document.querySelector<HTMLButtonElement>("#redact-now")!;
const clipboardButton = document.querySelector<HTMLButtonElement>("#clipboard-import")!;
const clipboardNote = document.querySelector<HTMLElement>("#clipboard-note")!;
const optionInputs = [...document.querySelectorAll<HTMLInputElement>("[data-option]")];
const actionButtons = [
  refreshButton,
  markdownButton,
  jsonButton,
  htmlButton,
  printButton,
  zipButton,
  selectAllButton,
  selectNoneButton,
  redactButton,
  clipboardButton
];

let conversation: ConversationExport | null = null;
const selectedIds = new Set<string>();

refreshButton.addEventListener("click", () => void loadConversation(false));
markdownButton.addEventListener("click", () => void exportCurrent("md"));
jsonButton.addEventListener("click", () => void exportCurrent("json"));
htmlButton.addEventListener("click", () => void exportCurrent("html"));
printButton.addEventListener("click", () => void exportCurrent("print"));
zipButton.addEventListener("click", () => void exportCurrent("zip"));
selectAllButton.addEventListener("click", () => selectMessages("all"));
selectNoneButton.addEventListener("click", () => selectMessages("none"));
redactButton.addEventListener("click", redactVisibleText);
clipboardButton.addEventListener("click", () => void importClipboard());
optionInputs.forEach((input) => input.addEventListener("change", render));
optionInputs
  .find((input) => input.dataset.option === "useProviderCopy")
  ?.addEventListener("change", () => {
    syncClipboardNote();
    void loadConversation(false);
  });

syncClipboardNote();
void loadConversation(true);

function syncClipboardNote(): void {
  const useProviderCopy = optionInputs.find((input) => input.dataset.option === "useProviderCopy");
  clipboardNote.hidden = !useProviderCopy?.checked;
}

async function loadConversation(preferManualSelection: boolean): Promise<void> {
  const options = readOptions();
  const label = options.useProviderCopy
    ? "Reading current tab... (copy buttons are clicked; the clipboard is read and restored)"
    : "Reading current tab...";
  await withBusy(actionButtons, showSummary, label, async () => {
    const stored = preferManualSelection ? await chrome.storage.session.get("manualSelection") : {};
    const storedResponse = stored.manualSelection as RuntimeResponse | undefined;
    const response = storedResponse?.ok
      ? storedResponse
      : await sendToActiveTab({ type: "EXTRACT_CONVERSATION", useProviderCopy: options.useProviderCopy });
    if (!response.ok) throw new Error(response.error);
    conversation = response.conversation;
    selectedIds.clear();
    conversation.messages.forEach((message) => selectedIds.add(message.id));
    await chrome.storage.session.remove("manualSelection");
    render();
  });
}

function render(): void {
  if (!conversation) {
    messagesRoot.innerHTML = `<div class="empty">No conversation loaded.</div>`;
    return;
  }

  const options = readOptions();
  const preview = applyExportOptions(pickSelectedMessages(), options);
  summary.textContent = `${preview.messages.length} of ${conversation.messages.length} messages · ${conversation.source.provider} · ${conversation.source.title}`;

  if (conversation.messages.length === 0) {
    messagesRoot.innerHTML = `<div class="empty">No messages detected. Use the popup's container selection on pages with unusual layouts.</div>`;
    return;
  }

  messagesRoot.replaceChildren(...conversation.messages.map(messageNode));
}

function messageNode(message: ChatMessage): HTMLElement {
  const included = selectedIds.has(message.id);
  const row = document.createElement("div");
  row.className = `message-row ${message.role} ${included ? "included" : "removed"}`;

  if (included) {
    const body = document.createElement("div");
    body.className = "message-body";
    body.innerHTML = messageHtml(message);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "message-remove";
    remove.textContent = "✕";
    remove.title = "Remove from export";
    remove.setAttribute("aria-label", "Remove from export");
    remove.addEventListener("click", () => {
      selectedIds.delete(message.id);
      render();
    });

    row.append(body, remove);
  } else {
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "message-restore";
    restore.textContent = `${message.role} message removed — click to restore`;
    restore.title = "Include again";
    restore.addEventListener("click", () => {
      selectedIds.add(message.id);
      render();
    });
    row.append(restore);
  }

  return row;
}

function messageHtml(message: ChatMessage): string {
  if (message.role === "user") {
    const text = message.content
      .map((block) => (block.type === "text" ? block.text : blockToPlainText(block)))
      .join("\n\n");
    return `<div class="bubble-text">${escapeHtml(text)}</div>`;
  }
  return message.content.map(blockToHtml).join("\n");
}

function blockToHtml(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return renderMarkdown(block.text);
    case "code":
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    case "table":
      return renderMarkdown(block.markdown);
    case "quote":
      return `<blockquote>${renderMarkdown(block.text)}</blockquote>`;
    case "image":
      return block.src
        ? `<figure><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt ?? "")}" loading="lazy">${block.alt || block.filename ? `<figcaption>${escapeHtml(block.filename ?? block.alt ?? "")}</figcaption>` : ""}</figure>`
        : `<p>${escapeHtml(block.filename ?? block.alt ?? "image")}</p>`;
  }
}

function blockToPlainText(block: ContentBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "code") return block.text;
  if (block.type === "table") return block.markdown;
  if (block.type === "quote") return block.text;
  return [block.alt, block.filename, block.src].filter(Boolean).join(" ");
}

async function exportCurrent(format: "md" | "json" | "html" | "print" | "zip"): Promise<void> {
  if (!conversation) return;
  await withBusy(actionButtons, showSummary, `Preparing ${format.toUpperCase()}...`, async () => {
    const prepared = applyExportOptions(pickSelectedMessages(), readOptions());
    const baseName = slugify(prepared.source.title);

    if (format === "md") {
      downloadBlob(blobFromText(exportMarkdown(prepared), "text/markdown;charset=utf-8"), `${baseName}.md`);
    } else if (format === "json") {
      downloadBlob(blobFromText(exportJson(prepared), "application/json;charset=utf-8"), `${baseName}.json`);
    } else if (format === "html") {
      downloadBlob(blobFromText(exportHtml(prepared), "text/html;charset=utf-8"), `${baseName}.html`);
    } else if (format === "print") {
      openPrintView(exportHtml(prepared));
    } else {
      const [snapshot, screenshot] = await Promise.all([getHtmlSnapshot(), captureScreenshot()]);
      const zip = await createEvidencePack({
        conversation: prepared,
        htmlSnapshot: snapshot,
        screenshotDataUrl: screenshot,
        browser: navigator.userAgent,
        platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform
      });
      downloadBlob(zip, `${baseName}-evidence.zip`);
    }

    summary.textContent = `Exported ${prepared.messages.length} messages.`;
  });
}

async function importClipboard(): Promise<void> {
  await withBusy(actionButtons, showSummary, "Reading clipboard text...", async () => {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error("Clipboard is empty.");
    conversation = await conversationFromClipboard(text);
    selectedIds.clear();
    conversation.messages.forEach((message) => selectedIds.add(message.id));
    render();
  });
}

function pickSelectedMessages(): ConversationExport {
  if (!conversation) throw new Error("No conversation loaded.");
  return {
    ...conversation,
    messages: conversation.messages.filter((message) => selectedIds.has(message.id))
  };
}

function readOptions(): ExportOptions {
  const options: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS };
  for (const input of optionInputs) {
    const key = input.dataset.option as keyof ExportOptions;
    if (key in DEFAULT_EXPORT_OPTIONS) options[key] = input.checked;
  }
  return options;
}

function selectMessages(mode: "all" | "none"): void {
  if (!conversation) return;
  selectedIds.clear();
  if (mode === "all") conversation.messages.forEach((message) => selectedIds.add(message.id));
  render();
}

function redactVisibleText(): void {
  if (!conversation) return;
  conversation = structuredClone(conversation);
  conversation.messages = conversation.messages.map((message): ChatMessage => {
    const current = message.content.map(blockToPlainText).join("\n\n");
    return { ...message, content: [{ type: "text", text: redactText(current) }] };
  });
  render();
}

function openPrintView(html: string): void {
  const blob = blobFromText(
    html.replace("</body>", "<script>window.addEventListener('load', () => setTimeout(() => window.print(), 150));</script></body>"),
    "text/html;charset=utf-8"
  );
  window.open(URL.createObjectURL(blob), "_blank", "noopener");
}

async function conversationFromClipboard(text: string): Promise<ConversationExport> {
  const chunks = splitClipboardMessages(text);
  const messages: ChatMessage[] = [];

  for (const [index, chunk] of chunks.entries()) {
    const role = inferClipboardRole(chunk.role, index);
    const body = chunk.text.trim();
    messages.push({
      id: stableId(role, body),
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

async function sendToActiveTab(message: object): Promise<RuntimeResponse> {
  const tabId = await getSourceTabId();
  if (!tabId) throw new Error("No source tab found. Open the chat tab, then open Chat Trail again.");
  return sendToTabWithContentScript(tabId, message);
}

async function getHtmlSnapshot(): Promise<string | undefined> {
  try {
    const tabId = await getSourceTabId();
    if (!tabId) return undefined;
    const response = (await sendToTabWithContentScript(tabId, { type: "GET_HTML_SNAPSHOT" })) as { ok: true; html: string } | { ok: false };
    return response.ok ? response.html : undefined;
  } catch (error) {
    console.warn(readableTabError(error).message);
    return undefined;
  }
}

async function captureScreenshot(): Promise<string | undefined> {
  try {
    const tabId = await getSourceTabId();
    if (!tabId) return undefined;
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch {
    return undefined;
  }
}

async function getSourceTabId(): Promise<number | undefined> {
  const stored = await chrome.storage.session.get("sourceTabId");
  if (typeof stored.sourceTabId === "number") return stored.sourceTabId;
  return getActiveTabId();
}

function showSummary(text: string): void {
  summary.textContent = text;
}

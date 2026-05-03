import "./style.css";
import { createEvidencePack } from "../exporters/evidence";
import { applyExportOptions } from "../exporters/filter";
import { exportHtml } from "../exporters/html";
import { exportJson } from "../exporters/json";
import { exportMarkdown } from "../exporters/markdown";
import { blobFromText, downloadBlob } from "../shared/download";
import { contentToPlainText } from "../normalizer/dom";
import { redactText } from "../shared/redaction";
import { slugify } from "../shared/strings";
import { sha256Hex, stableId } from "../shared/hash";
import { readableTabError, sendToTabWithContentScript } from "../shared/tabs";
import { ChatMessage, ConversationExport, DEFAULT_EXPORT_OPTIONS, ExportOptions, RuntimeResponse } from "../shared/types";

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

void loadConversation(true);

async function loadConversation(preferManualSelection: boolean): Promise<void> {
  await withBusy("Reading current tab...", async () => {
    const stored = preferManualSelection ? await chrome.storage.session.get("manualSelection") : {};
    const storedResponse = stored.manualSelection as RuntimeResponse | undefined;
    const response = storedResponse?.ok ? storedResponse : await sendToActiveTab({ type: "EXTRACT_CONVERSATION" });
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
  const preview = applyExportOptions(pickSelectedMessages(readEditedConversation()), options);
  summary.textContent = `${preview.messages.length} of ${conversation.messages.length} messages selected from ${conversation.source.provider} | ${conversation.source.title}`;

  if (conversation.messages.length === 0) {
    messagesRoot.innerHTML = `<div class="empty">No messages detected. Use the popup's container selection on pages with unusual layouts.</div>`;
    return;
  }

  messagesRoot.replaceChildren(
    ...conversation.messages.map((message) => {
      const card = document.createElement("article");
      card.className = `message-card ${message.role}`;
      card.dataset.messageId = message.id;

      const head = document.createElement("div");
      head.className = "message-head";

      const role = document.createElement("span");
      role.className = "role";
      role.textContent = `${message.role} ${message.metadata.index != null ? message.metadata.index + 1 : ""}`;

      const checkboxLabel = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = selectedIds.has(message.id);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedIds.add(message.id);
        else selectedIds.delete(message.id);
        render();
      });
      checkboxLabel.append(checkbox, " include");
      head.append(role, checkboxLabel);

      const textarea = document.createElement("textarea");
      textarea.value = contentToPlainText(message.content);
      textarea.dataset.messageId = message.id;
      textarea.addEventListener("input", syncEditedMessage);

      card.append(head, textarea);
      return card;
    })
  );
}

async function exportCurrent(format: "md" | "json" | "html" | "print" | "zip"): Promise<void> {
  if (!conversation) return;
  await withBusy(`Preparing ${format.toUpperCase()}...`, async () => {
    const prepared = applyExportOptions(pickSelectedMessages(readEditedConversation()), readOptions());
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
        platform: navigator.platform
      });
      downloadBlob(zip, `${baseName}-evidence.zip`);
    }

    summary.textContent = `Exported ${prepared.messages.length} messages.`;
  });
}

async function importClipboard(): Promise<void> {
  await withBusy("Reading clipboard text...", async () => {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error("Clipboard is empty.");
    conversation = await conversationFromClipboard(text);
    selectedIds.clear();
    conversation.messages.forEach((message) => selectedIds.add(message.id));
    render();
  });
}

function readEditedConversation(): ConversationExport {
  if (!conversation) throw new Error("No conversation loaded.");
  const edited = structuredClone(conversation);
  const textareas = [...document.querySelectorAll<HTMLTextAreaElement>("textarea[data-message-id]")];
  const edits = new Map(textareas.map((textarea) => [textarea.dataset.messageId!, textarea.value]));

  edited.messages = edited.messages.map((message): ChatMessage => {
    const text = edits.get(message.id);
    if (text == null) return message;
    return { ...message, content: [{ type: "text", text }] };
  });

  return edited;
}

function pickSelectedMessages(input: ConversationExport): ConversationExport {
  return {
    ...input,
    messages: input.messages.filter((message) => selectedIds.has(message.id))
  };
}

function readOptions(): ExportOptions {
  const options: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS };
  for (const input of optionInputs) {
    const key = input.dataset.option as keyof ExportOptions;
    options[key] = input.checked;
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
  document.querySelectorAll<HTMLTextAreaElement>("textarea[data-message-id]").forEach((textarea) => {
    textarea.value = redactText(textarea.value);
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
      id: stableId(role, index, body),
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

function syncEditedMessage(event: Event): void {
  const textarea = event.currentTarget as HTMLTextAreaElement;
  if (textarea.dataset.messageId) selectedIds.add(textarea.dataset.messageId);
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
    if (tabId) await chrome.tabs.update(tabId, { active: true });
    return await chrome.tabs.captureVisibleTab(chrome.windows.WINDOW_ID_CURRENT, { format: "png" });
  } catch {
    return undefined;
  }
}

async function getSourceTabId(): Promise<number | undefined> {
  const stored = await chrome.storage.session.get("sourceTabId");
  if (typeof stored.sourceTabId === "number") return stored.sourceTabId;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

async function withBusy(label: string, task: () => Promise<void>): Promise<void> {
  actionButtons.forEach((button) => {
    button.disabled = true;
  });
  summary.textContent = label;
  try {
    await task();
  } catch (error) {
    summary.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    actionButtons.forEach((button) => {
      button.disabled = false;
    });
  }
}

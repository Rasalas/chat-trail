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
import { contentToMarkdown, renderMarkdown } from "../shared/markdown";

const summary = document.querySelector<HTMLElement>("#summary")!;
const chatTitle = document.querySelector<HTMLElement>("#chat-title")!;
const messagesRoot = document.querySelector<HTMLElement>("#messages")!;
const toast = document.querySelector<HTMLElement>("#toast")!;
const refreshButton = document.querySelector<HTMLButtonElement>("#refresh")!;
const selectAllButton = document.querySelector<HTMLButtonElement>("#select-all")!;
const selectNoneButton = document.querySelector<HTMLButtonElement>("#select-none")!;
const redactButton = document.querySelector<HTMLButtonElement>("#redact-now")!;
const clipboardButton = document.querySelector<HTMLButtonElement>("#clipboard-import")!;
const clipboardNote = document.querySelector<HTMLElement>("#clipboard-note")!;
const optionInputs = [...document.querySelectorAll<HTMLInputElement>("[data-option]")];
const exportButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-export]")];
const copyButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-copy]")];
const actionButtons = [
  refreshButton,
  clipboardButton,
  redactButton,
  selectAllButton,
  selectNoneButton,
  ...copyButtons,
  ...exportButtons
];

let conversation: ConversationExport | null = null;
const selectedIds = new Set<string>();
let editingId: string | null = null;
const OPTIONS_STORAGE_KEY = "exportOptions";
let toastTimer: number | undefined;

refreshButton.addEventListener("click", () => void loadConversation(false));
exportButtons.forEach((button) =>
  button.addEventListener("click", () => {
    closePopovers();
    void exportCurrent(button.dataset.export as "md" | "json" | "html" | "print" | "zip");
  })
);
copyButtons.forEach((button) =>
  button.addEventListener("click", () => {
    closePopovers();
    void copyExport(button.dataset.copy as "md" | "json" | "html");
  })
);
selectAllButton.addEventListener("click", () => selectMessages("all"));
selectNoneButton.addEventListener("click", () => selectMessages("none"));
redactButton.addEventListener("click", redactVisibleText);
clipboardButton.addEventListener("click", () => void importClipboard());
optionInputs.forEach((input) =>
  input.addEventListener("change", () => {
    persistOptions();
    render();
  })
);
optionInputs
  .find((input) => input.dataset.option === "useProviderCopy")
  ?.addEventListener("change", () => {
    syncClipboardNote();
    void loadConversation(false);
  });
document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  document.querySelectorAll("details.popover[open]").forEach((popover) => {
    if (!popover.contains(target)) popover.removeAttribute("open");
  });
});

syncClipboardNote();
void restoreOptions().then(() => loadConversation(true));

function closePopovers(): void {
  document.querySelectorAll("details.popover[open]").forEach((popover) => popover.removeAttribute("open"));
}

async function restoreOptions(): Promise<void> {
  const stored = await chrome.storage.sync.get(OPTIONS_STORAGE_KEY);
  const saved = stored[OPTIONS_STORAGE_KEY] as Partial<ExportOptions> | undefined;
  if (!saved) return;
  for (const input of optionInputs) {
    const key = input.dataset.option as keyof ExportOptions;
    if (key in saved) input.checked = Boolean(saved[key]);
  }
  syncClipboardNote();
}

function persistOptions(): void {
  void chrome.storage.sync.set({ [OPTIONS_STORAGE_KEY]: readOptions() });
}

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
  chatTitle.textContent = conversation.source.title || "Chat Export";
  summary.textContent = metaLine(conversation, preview.messages.length);

  if (preview.messages.length === 0) {
    messagesRoot.innerHTML = `<div class="empty">No messages selected for export.</div>`;
    return;
  }

  messagesRoot.replaceChildren(...preview.messages.map(messageNode));
}

function metaLine(conversation: ConversationExport, count: number): string {
  const parts = [
    count === conversation.messages.length ? `${conversation.messages.length} messages` : `${count} of ${conversation.messages.length} messages`,
    conversation.source.provider,
    conversation.source.model,
    conversation.source.captured_at ? `captured ${conversation.source.captured_at}` : undefined,
    conversation.source.url
  ].filter(Boolean);
  return parts.join(" · ");
}

function messageNode(message: ChatMessage): HTMLElement {
  const included = selectedIds.has(message.id);
  const row = document.createElement("div");
  row.className = `message-row ${message.role} ${included ? "included" : "removed"}`;

  if (!included) {
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
    return row;
  }

  if (editingId === message.id) {
    row.append(editorNode(message));
    return row;
  }

  const body = document.createElement("div");
  body.className = "message-body";
  body.innerHTML = messageHtml(message);
  body.querySelectorAll("img").forEach((img) => {
    img.addEventListener("error", () => {
      const fallback = document.createElement("span");
      fallback.className = "img-fallback";
      fallback.textContent = img.getAttribute("data-fallback") || img.alt || "image could not be loaded";
      img.replaceWith(fallback);
    });
  });

  const actions = document.createElement("div");
  actions.className = "message-actions";

  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "message-edit";
  edit.title = "Edit (markdown)";
  edit.setAttribute("aria-label", "Edit message");
  edit.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"/></svg>';
  edit.addEventListener("click", () => {
    editingId = message.id;
    render();
  });

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "message-remove";
  remove.title = "Remove from export";
  remove.setAttribute("aria-label", "Remove from export");
  remove.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 18L18 6M6 6l12 12"/></svg>';
  remove.addEventListener("click", () => {
    selectedIds.delete(message.id);
    render();
  });

  actions.append(edit, remove);
  row.append(body, actions);
  return row;
}

function editorNode(message: ChatMessage): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "message-editor";

  const textarea = document.createElement("textarea");
  textarea.value = contentToMarkdown(message.content);
  textarea.spellcheck = false;
  const autoGrow = () => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 640)}px`;
  };
  textarea.addEventListener("input", autoGrow);
  textarea.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      saveEdit(message, textarea.value);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      editingId = null;
      render();
    }
  });

  const bar = document.createElement("div");
  bar.className = "editor-buttons";

  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary";
  save.textContent = "Save";
  save.addEventListener("click", () => saveEdit(message, textarea.value));

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "Cancel";
  cancel.addEventListener("click", () => {
    editingId = null;
    render();
  });

  const hint = document.createElement("span");
  hint.className = "editor-hint";
  hint.textContent = "markdown · ctrl/cmd+enter save · esc cancel";

  bar.append(save, cancel, hint);
  wrap.append(textarea, bar);
  requestAnimationFrame(() => {
    autoGrow();
    textarea.focus();
  });
  return wrap;
}

function saveEdit(message: ChatMessage, value: string): void {
  const target = conversation?.messages.find((candidate) => candidate.id === message.id);
  if (target) target.content = [{ type: "text", text: value }];
  editingId = null;
  render();
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
    case "image": {
      const label = block.filename ?? block.alt ?? "";
      const caption = label && !/^[a-z0-9_-]{32,}$/i.test(label) ? label : "";
      if (!block.src) return `<p>${escapeHtml(label || "image")}</p>`;
      const img = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt ?? "")}" loading="lazy" referrerpolicy="no-referrer" data-fallback="${escapeHtml(block.filename ?? "")}">`;
      return `<figure>${img}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
    }
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

    restoreMeta();
    showToast(`${format.toUpperCase()} exported.`);
  });
}

async function copyExport(format: "md" | "json" | "html"): Promise<void> {
  if (!conversation) return;
  await withBusy(actionButtons, showSummary, `Copying ${format.toUpperCase()}...`, async () => {
    const prepared = applyExportOptions(pickSelectedMessages(), readOptions());
    const content = format === "md" ? exportMarkdown(prepared) : format === "json" ? exportJson(prepared) : exportHtml(prepared);
    await navigator.clipboard.writeText(content);
    restoreMeta();
    showToast(`${format.toUpperCase()} copied to clipboard.`);
  });
}

function restoreMeta(): void {
  if (!conversation) return;
  const preview = applyExportOptions(pickSelectedMessages(), readOptions());
  summary.textContent = metaLine(conversation, preview.messages.length);
}

function showToast(message: string): void {
  if (toastTimer) window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 2600);
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

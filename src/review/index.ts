import "./style.css";
import { createEvidencePack } from "../exporters/evidence";
import { applyExportOptions, filterMessage, redactBlock } from "../exporters/filter";
import { exportHtml } from "../exporters/html";
import { exportJson } from "../exporters/json";
import { exportMarkdown } from "../exporters/markdown";
import { intermediateAssistantFlags } from "../exporters/turns";
import { blobFromText, downloadBlob } from "../shared/download";
import { escapeHtml } from "../shared/strings";
import { slugify } from "../shared/strings";
import { ChatMessage, ConversationExport, ContentBlock, DEFAULT_EXPORT_OPTIONS, ExportOptions, RuntimeResponse } from "../shared/types";
import { contentToMarkdown, renderMarkdown } from "../shared/markdown";
import { sanitizeContentHtml } from "../shared/sanitize";
import { captureWarning } from "../shared/capture";
import { readReviewSession, updateReviewCapture } from "../shared/review-session";
import { conversationFromClipboard } from "./clipboard";
import { captureOriginalEvidence } from "./original-evidence";
import { printHtml } from "./print";
import { captureInSourceTab, fetchCapture } from "./source-capture";

const reviewSessionId = new URL(document.location.href).searchParams.get("session");
const originalPageInput = document.querySelector<HTMLInputElement>("#include-original-page")!;
const captureNotice = document.querySelector<HTMLElement>("#capture-notice")!;
const busyLine = document.querySelector<HTMLElement>("#busy-line")!;
const errorLine = document.querySelector<HTMLElement>("#error-line")!;

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
const providerCopyInput = optionInputs.find((input) => input.dataset.option === "useProviderCopy");
const exportButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-export]")];
const copyButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-copy]")];
const popovers = [...document.querySelectorAll<HTMLDetailsElement>("details.popover")];
const actionButtons = [
  refreshButton,
  clipboardButton,
  redactButton,
  selectAllButton,
  selectNoneButton,
  ...copyButtons,
  ...exportButtons
];

type ExportFormat = "md" | "json" | "html" | "print" | "zip";

interface PreviewEntry {
  content: ChatMessage["content"];
  optionsKey: string;
  message: ChatMessage;
  html: string;
}

interface RowEntry {
  row: HTMLElement;
  state: "shown" | "removed" | "editing";
  preview: PreviewEntry | null;
}

let conversation: ConversationExport | null = null;
const selectedIds = new Set<string>();
let editingId: string | null = null;
// Edits and redactions; exclusions are derived from selectedIds.
let modified = false;
let redactionUndo: Map<string, ChatMessage["content"]> | null = null;
const previewCache = new Map<string, PreviewEntry>();
const rowCache = new Map<string, RowEntry>();
const OPTIONS_STORAGE_KEY = "exportOptions";
let toastTimer: number | undefined;

refreshButton.addEventListener("click", () => {
  if (confirmDiscard("Refreshing")) void recapture();
});
exportButtons.forEach((button) =>
  button.addEventListener("click", () => {
    closePopovers();
    void exportCurrent(button.dataset.export as ExportFormat);
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
clipboardButton.addEventListener("click", () => {
  if (confirmDiscard("Importing from the clipboard")) void importClipboard();
});
optionInputs
  .filter((input) => input !== providerCopyInput)
  .forEach((input) =>
    input.addEventListener("change", () => {
      persistOptions();
      render();
    })
  );
providerCopyInput?.addEventListener("change", () => {
  if (!confirmDiscard("Changing the extraction method")) {
    providerCopyInput.checked = !providerCopyInput.checked;
    return;
  }
  persistOptions();
  syncClipboardNote();
  void recapture();
});

popovers.forEach((popover) =>
  popover.addEventListener("toggle", () => {
    if (!popover.open) return;
    popovers.forEach((other) => {
      if (other !== popover) other.open = false;
    });
  })
);
document.addEventListener("click", (event) => {
  const target = event.target as Node;
  popovers.forEach((popover) => {
    if (popover.open && !popover.contains(target)) popover.open = false;
  });
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const open = popovers.find((popover) => popover.open);
  if (!open) return;
  event.preventDefault();
  open.open = false;
  open.querySelector<HTMLElement>("summary")?.focus();
});

syncClipboardNote();
showLoading("Loading capture...");
void restoreOptions().then(loadStoredCapture);

function closePopovers(): void {
  popovers.forEach((popover) => {
    popover.open = false;
  });
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
  clipboardNote.hidden = !providerCopyInput?.checked;
}

function hasUnsavedWork(): boolean {
  if (!conversation) return false;
  return modified || selectedIds.size < conversation.messages.length;
}

function confirmDiscard(action: string): boolean {
  if (!hasUnsavedWork()) return true;
  return window.confirm(`${action} replaces the current review. Your edits, exclusions and redactions will be lost. Continue?`);
}

async function runBusy(label: string, task: () => Promise<void>): Promise<void> {
  actionButtons.forEach((button) => {
    button.disabled = true;
  });
  showError(undefined);
  busyLine.textContent = label;
  busyLine.hidden = false;
  try {
    await task();
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    if (!conversation) messagesRoot.innerHTML = `<div class="empty">No conversation loaded.</div>`;
  } finally {
    busyLine.hidden = true;
    actionButtons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function showError(message: string | undefined): void {
  errorLine.textContent = message ?? "";
  errorLine.hidden = !message;
}

function showLoading(label: string): void {
  if (conversation) return;
  const empty = document.createElement("div");
  empty.className = "empty loading";
  empty.textContent = label;
  messagesRoot.replaceChildren(empty);
}

async function loadStoredCapture(): Promise<void> {
  await runBusy("Loading capture...", async () => {
    applyResponse(await fetchCapture(await readReviewSession(reviewSessionId)));
  });
}

async function recapture(): Promise<void> {
  const options = readOptions();
  const label = options.useProviderCopy
    ? "Capturing in the source tab... (copy buttons are clicked; the clipboard is read and restored)"
    : "Capturing in the source tab...";
  showLoading(label);
  await runBusy(label, async () => {
    const session = await readReviewSession(reviewSessionId);
    const captureId = await captureInSourceTab(session.sourceTabId, options.useProviderCopy);
    await updateReviewCapture(reviewSessionId!, captureId);
    applyResponse(await fetchCapture({ ...session, captureId }));
  });
}

function applyResponse(response: RuntimeResponse): void {
  if (!response.ok) throw new Error(response.error);
  setConversation(response.conversation);
}

function setConversation(next: ConversationExport): void {
  conversation = next;
  selectedIds.clear();
  conversation.messages.forEach((message) => selectedIds.add(message.id));
  editingId = null;
  modified = false;
  redactionUndo = null;
  previewCache.clear();
  rowCache.clear();
  originalPageInput.checked = false;
  render();
}

function render(): void {
  if (!conversation) {
    messagesRoot.innerHTML = `<div class="empty">No conversation loaded.</div>`;
    return;
  }

  const warning = captureWarning(conversation);
  captureNotice.textContent = warning ?? "";
  captureNotice.hidden = !warning;
  originalPageInput.disabled = conversation.source.provider === "clipboard";
  const title = conversation.source.title || "Chat Export";
  chatTitle.textContent = title;
  document.title = `${title} – Chat Trail`;

  const shown = previewEntries(conversation.messages, readOptions());
  const meta = metaLine(conversation, shown.size);
  summary.textContent = meta;
  summary.title = meta;

  const rows: HTMLElement[] = [];
  const used = new Set<string>();
  for (const message of conversation.messages) {
    const included = selectedIds.has(message.id);
    const preview = shown.get(message.id) ?? null;
    // Included messages that the options drop (e.g. image-only without images) are not shown.
    if (included && !preview) continue;
    rows.push(rowFor(message, preview));
    used.add(message.id);
  }
  for (const id of rowCache.keys()) {
    if (!used.has(id)) rowCache.delete(id);
  }

  if (rows.length === 0) {
    messagesRoot.innerHTML = `<div class="empty">No messages to show.</div>`;
    return;
  }
  reconcileChildren(messagesRoot, rows);
}

// Mirrors applyExportOptions for the selected messages without cloning the conversation.
function previewEntries(messages: ChatMessage[], options: ExportOptions): Map<string, PreviewEntry> {
  const optionsKey = `${options.redactSecrets}|${options.includeImages}`;
  const entries: PreviewEntry[] = [];
  for (const message of messages) {
    if (!selectedIds.has(message.id)) continue;
    const entry = previewFor(message, optionsKey, options);
    if (entry.message.content.length > 0) entries.push(entry);
  }
  const interim = options.collapseIntermediate ? [] : intermediateAssistantFlags(entries.map((entry) => entry.message));
  return new Map(entries.filter((_, index) => !interim[index]).map((entry) => [entry.message.id, entry]));
}

// Cached by content identity: edits and redactions replace a message's content array.
function previewFor(message: ChatMessage, optionsKey: string, options: ExportOptions): PreviewEntry {
  const cached = previewCache.get(message.id);
  if (cached && cached.content === message.content && cached.optionsKey === optionsKey) return cached;
  const filtered = filterMessage(message, options);
  const entry = { content: message.content, optionsKey, message: filtered, html: sanitizeContentHtml(messageHtml(filtered)) };
  previewCache.set(message.id, entry);
  return entry;
}

function rowFor(message: ChatMessage, preview: PreviewEntry | null): HTMLElement {
  const state: RowEntry["state"] = !preview ? "removed" : editingId === message.id ? "editing" : "shown";
  const cached = rowCache.get(message.id);
  if (cached && cached.state === state && cached.preview === preview) return cached.row;
  const row = messageNode(message, state, preview);
  rowCache.set(message.id, { row, state, preview });
  return row;
}

// Reuses existing row nodes so images are not reloaded and the scroll position stays put.
function reconcileChildren(parent: HTMLElement, nodes: HTMLElement[]): void {
  const wanted = new Set<Node>(nodes);
  for (const child of [...parent.childNodes]) {
    if (!wanted.has(child)) child.remove();
  }
  nodes.forEach((node, index) => {
    if (parent.childNodes[index] !== node) parent.insertBefore(node, parent.childNodes[index] ?? null);
  });
}

function metaLine(conversation: ConversationExport, count: number): string {
  const unit = conversation.messages.length > 0 && conversation.messages.every((message) => message.kind === "document")
    ? "sections"
    : "messages";
  const parts = [
    count === conversation.messages.length ? `${conversation.messages.length} ${unit}` : `${count} of ${conversation.messages.length} ${unit}`,
    conversation.source.provider,
    conversation.source.model,
    conversation.source.captured_at ? `captured ${conversation.source.captured_at}` : undefined,
    conversation.source.url
  ].filter(Boolean);
  return parts.join(" · ");
}

function messageNode(message: ChatMessage, state: RowEntry["state"], preview: PreviewEntry | null): HTMLElement {
  const row = document.createElement("div");
  row.className = `message-row ${message.role} ${message.kind ?? ""} ${state === "removed" ? "removed" : "included"}`;

  if (state === "removed") {
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "message-restore";
    restore.textContent = message.kind === "document"
      ? "Document section excluded — click to include again"
      : `${message.role} message excluded — click to include again`;
    restore.title = "Include again";
    restore.addEventListener("click", () => {
      selectedIds.add(message.id);
      render();
    });
    row.append(restore);
    return row;
  }

  if (state === "editing") {
    row.append(editorNode(message));
    return row;
  }

  const body = document.createElement("div");
  body.className = "message-body";
  body.innerHTML = preview!.html;
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
  remove.title = "Exclude from export";
  remove.setAttribute("aria-label", "Exclude from export");
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
  textarea.setAttribute("aria-label", "Message markdown");
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
      event.stopPropagation();
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
  if (target && value !== contentToMarkdown(target.content)) {
    target.content = [{ type: "text", text: value }];
    modified = true;
    redactionUndo = null;
  }
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

async function exportCurrent(format: ExportFormat): Promise<void> {
  if (!conversation) return;
  const label = format === "print" ? "Preparing print view..." : `Preparing ${format.toUpperCase()}...`;
  await runBusy(label, async () => {
    const prepared = applyExportOptions(pickSelectedMessages(), readOptions());
    const baseName = slugify(prepared.source.title);

    if (format === "md") {
      downloadBlob(blobFromText(exportMarkdown(prepared), "text/markdown;charset=utf-8"), `${baseName}.md`);
    } else if (format === "json") {
      downloadBlob(blobFromText(exportJson(prepared), "application/json;charset=utf-8"), `${baseName}.json`);
    } else if (format === "html") {
      downloadBlob(blobFromText(exportHtml(prepared), "text/html;charset=utf-8"), `${baseName}.html`);
    } else if (format === "print") {
      await printHtml(document, exportHtml(prepared));
      return;
    } else {
      const includeOriginalPage = originalPageInput.checked && prepared.source.provider !== "clipboard";
      originalPageInput.checked = false;
      const original = includeOriginalPage
        ? await captureOriginalEvidence(await getSourceTabId(), conversation!.source.url)
        : {};

      const zip = await createEvidencePack({
        conversation: prepared,
        ...original,
        includeOriginalPage,
        browser: navigator.userAgent,
        platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform
      });
      downloadBlob(zip, `${baseName}-evidence.zip`);
    }

    showToast(`${format.toUpperCase()} exported.`);
  });
}

async function copyExport(format: "md" | "json" | "html"): Promise<void> {
  if (!conversation) return;
  await runBusy(`Copying ${format.toUpperCase()}...`, async () => {
    const prepared = applyExportOptions(pickSelectedMessages(), readOptions());
    const content = format === "md" ? exportMarkdown(prepared) : format === "json" ? exportJson(prepared) : exportHtml(prepared);
    await navigator.clipboard.writeText(content);
    showToast(`${format.toUpperCase()} copied to clipboard.`);
  });
}

function showToast(message: string, action?: { label: string; run(): void }): void {
  if (toastTimer) window.clearTimeout(toastTimer);
  const text = document.createElement("span");
  text.textContent = message;
  toast.replaceChildren(text);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    button.addEventListener("click", () => {
      toast.hidden = true;
      action.run();
    });
    toast.append(button);
  }
  toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, action ? 10_000 : 2600);
}

async function importClipboard(): Promise<void> {
  await runBusy("Reading clipboard text...", async () => {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) throw new Error("Clipboard is empty.");
    setConversation(await conversationFromClipboard(text));
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

// Redacts block by block so code, tables, quotes and images keep their structure.
function redactVisibleText(): void {
  if (!conversation) return;
  closePopovers();
  const previous = new Map<string, ChatMessage["content"]>();
  for (const message of conversation.messages) {
    const content = message.content.map(redactBlock);
    if (!content.some((block, index) => blockChanged(message.content[index], block))) continue;
    previous.set(message.id, message.content);
    message.content = content;
  }
  if (previous.size === 0) {
    showToast("No secrets found in the text.");
    return;
  }
  modified = true;
  redactionUndo = previous;
  render();
  showToast(`Redacted secrets in ${previous.size} message${previous.size === 1 ? "" : "s"}.`, { label: "Undo", run: undoRedaction });
}

function undoRedaction(): void {
  if (!conversation || !redactionUndo) return;
  for (const message of conversation.messages) {
    const content = redactionUndo.get(message.id);
    if (content) message.content = content;
  }
  redactionUndo = null;
  render();
  showToast("Redaction undone.");
}

function blockChanged(before: ContentBlock, after: ContentBlock): boolean {
  if (before.type === "table" && after.type === "table") return before.markdown !== after.markdown;
  if (before.type === "image" && after.type === "image") return before.alt !== after.alt || before.filename !== after.filename;
  if ("text" in before && "text" in after) return before.text !== after.text;
  return false;
}

async function getSourceTabId(): Promise<number> {
  return (await readReviewSession(reviewSessionId)).sourceTabId;
}

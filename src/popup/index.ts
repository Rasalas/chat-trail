import "./style.css";
import { applyExportOptions } from "../exporters/filter";
import { exportMarkdown } from "../exporters/markdown";
import { blobFromText, downloadBlob } from "../shared/download";
import { getActiveTabId, sendToTabWithContentScript } from "../shared/tabs";
import { withBusy } from "../shared/ui";
import { DEFAULT_EXPORT_OPTIONS, ContentRequest, ContentResponse } from "../shared/types";
import { slugify } from "../shared/strings";
import { openReviewSession } from "../shared/review-session";
import { captureWarning } from "../shared/capture";

const status = document.querySelector<HTMLParagraphElement>("#status")!;
const statusDot = document.querySelector<HTMLSpanElement>("#status-dot")!;
const quickMarkdown = document.querySelector<HTMLButtonElement>("#quick-md")!;
const copyMarkdown = document.querySelector<HTMLButtonElement>("#copy-md")!;
const openReview = document.querySelector<HTMLButtonElement>("#open-review")!;
const selectContainer = document.querySelector<HTMLButtonElement>("#select-container")!;
const buttons = [quickMarkdown, copyMarkdown, openReview, selectContainer];

function showStatus(text: string, isError?: boolean): void {
  setStatus(text, isError ? "error" : undefined);
}

quickMarkdown.addEventListener("click", () => void quickExport());
copyMarkdown.addEventListener("click", () => void copyMarkdownToClipboard());
openReview.addEventListener("click", () => void openReviewPage());
selectContainer.addEventListener("click", () => void selectAndReview());

setStatus("Ready to read the active tab.", "ready");

async function quickExport(): Promise<void> {
  await withBusy(buttons, showStatus, "Extracting transcript...", async () => {
    const response = await sendToActiveTab({ type: "EXTRACT_CONVERSATION", useProviderCopy: false });
    if (!response.ok) throw new Error(response.error);
    const filtered = applyExportOptions(response.conversation, DEFAULT_EXPORT_OPTIONS);
    const markdown = exportMarkdown(filtered);
    downloadBlob(blobFromText(markdown, "text/markdown;charset=utf-8"), `${slugify(filtered.source.title)}.md`);
    const warning = captureWarning(filtered);
    setStatus(warning ?? `Saved ${filtered.messages.length} messages from ${response.adapterLabel}.`, warning ? "error" : "ready");
  });
}

async function copyMarkdownToClipboard(): Promise<void> {
  await withBusy(buttons, showStatus, "Preparing Markdown...", async () => {
    const response = await sendToActiveTab({ type: "EXTRACT_CONVERSATION", useProviderCopy: false });
    if (!response.ok) throw new Error(response.error);
    const filtered = applyExportOptions(response.conversation, DEFAULT_EXPORT_OPTIONS);
    await navigator.clipboard.writeText(exportMarkdown(filtered));
    const warning = captureWarning(filtered);
    setStatus(warning ?? "Markdown copied to clipboard.", warning ? "error" : "ready");
  });
}

async function openReviewPage(): Promise<void> {
  await withBusy(buttons, showStatus, "Opening review...", async () => {
    const tabId = await getActiveTabId();
    if (tabId == null) throw new Error("No active tab found.");
    await openReviewSession(tabId);
    window.close();
  });
}

async function selectAndReview(): Promise<void> {
  await withBusy(buttons, showStatus, "Switch to the page and click a chat container.", async () => {
    const response = await sendToActiveTab({ type: "START_CONTAINER_SELECTION" });
    if (!response.ok) throw new Error(response.error);
    setStatus("Selection mode started. Choose an area on the page or cancel with Esc.", "ready");
    window.close();
  });
}

async function sendToActiveTab<Request extends ContentRequest>(message: Request): Promise<ContentResponse<Request>> {
  const tabId = await getActiveTabId();
  if (!tabId) throw new Error("No active tab found.");
  return sendToTabWithContentScript(tabId, message);
}

function setStatus(text: string, state?: "ready" | "error"): void {
  status.textContent = text;
  statusDot.className = `status-dot ${state ?? ""}`.trim();
}

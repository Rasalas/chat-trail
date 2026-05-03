import "./style.css";
import { applyExportOptions } from "../exporters/filter";
import { exportMarkdown } from "../exporters/markdown";
import { blobFromText, downloadBlob } from "../shared/download";
import { sendToTabWithContentScript } from "../shared/tabs";
import { DEFAULT_EXPORT_OPTIONS, RuntimeResponse } from "../shared/types";
import { slugify } from "../shared/strings";

const status = document.querySelector<HTMLParagraphElement>("#status")!;
const statusDot = document.querySelector<HTMLSpanElement>("#status-dot")!;
const quickMarkdown = document.querySelector<HTMLButtonElement>("#quick-md")!;
const openReview = document.querySelector<HTMLButtonElement>("#open-review")!;
const selectContainer = document.querySelector<HTMLButtonElement>("#select-container")!;
const buttons = [quickMarkdown, openReview, selectContainer];

quickMarkdown.addEventListener("click", () => void quickExport());
openReview.addEventListener("click", () => void openReviewPage());
selectContainer.addEventListener("click", () => void selectAndReview());

setStatus("Ready to read the active tab.", "ready");

async function quickExport(): Promise<void> {
  await withBusy("Extracting transcript...", async () => {
    const response = await sendToActiveTab({ type: "EXTRACT_CONVERSATION" });
    if (!response.ok) throw new Error(response.error);
    const filtered = applyExportOptions(response.conversation, DEFAULT_EXPORT_OPTIONS);
    const markdown = exportMarkdown(filtered);
    downloadBlob(blobFromText(markdown, "text/markdown;charset=utf-8"), `${slugify(filtered.source.title)}.md`);
    setStatus(`Saved ${filtered.messages.length} messages from ${response.adapterLabel}.`, "ready");
  });
}

async function openReviewPage(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await chrome.storage.session.set({ sourceTabId: tab.id });
  const url = chrome.runtime.getURL("src/review/index.html");
  await chrome.tabs.create({ url });
  window.close();
}

async function selectAndReview(): Promise<void> {
  await withBusy("Switch to the page and click a chat container.", async () => {
    const response = await sendToActiveTab({ type: "START_CONTAINER_SELECTION" });
    if (!response.ok) throw new Error(response.error);
    await chrome.storage.session.set({ manualSelection: response });
    await openReviewPage();
  });
}

async function sendToActiveTab(message: object): Promise<RuntimeResponse> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab found.");
  await chrome.storage.session.set({ sourceTabId: tab.id });
  return sendToTabWithContentScript(tab.id, message);
}

async function withBusy(label: string, task: () => Promise<void>): Promise<void> {
  buttons.forEach((button) => {
    button.disabled = true;
  });
  setStatus(label);
  try {
    await task();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "error");
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

function setStatus(text: string, state?: "ready" | "error"): void {
  status.textContent = text;
  statusDot.className = `status-dot ${state ?? ""}`.trim();
}

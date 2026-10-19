import "./style.css";
import { getActiveTabId, sendToTabWithContentScript } from "../shared/tabs";
import { withBusy } from "../shared/ui";
import { CaptureAction, ContentRequest, ContentResponse } from "../shared/types";
import { describePage, pageStatus } from "./providers";

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

quickMarkdown.addEventListener("click", () => void startCapture("download"));
copyMarkdown.addEventListener("click", () => void startCapture("copy"));
openReview.addEventListener("click", () => void startCapture("review"));
selectContainer.addEventListener("click", () => void selectAndReview());

void showDetectedPage();

// activeTab exposes the tab URL once the popup is open, so this needs no extra permission.
async function showDetectedPage(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const { text, state } = pageStatus(describePage(tab?.url));
  setStatus(text, state);
}

// The capture runs in the page (progress shown there), so the popup can close before it finishes.
async function startCapture(action: CaptureAction): Promise<void> {
  await withBusy(buttons, showStatus, "Starting capture...", async () => {
    const response = await sendToActiveTab({ type: "START_CAPTURE", action });
    if (!response.ok) throw new Error(response.error);
    window.close();
  });
}

async function selectAndReview(): Promise<void> {
  await withBusy(buttons, showStatus, "Starting selection...", async () => {
    const response = await sendToActiveTab({ type: "START_CONTAINER_SELECTION" });
    if (!response.ok) throw new Error(response.error);
    window.close();
  });
}

async function sendToActiveTab<Request extends ContentRequest>(message: Request): Promise<ContentResponse<Request>> {
  const tabId = await getActiveTabId();
  if (!tabId) throw new Error("No active tab found.");
  return sendToTabWithContentScript(tabId, message);
}

function setStatus(text: string, state?: "ready" | "warning" | "error"): void {
  status.textContent = text;
  statusDot.className = `status-dot ${state ?? ""}`.trim();
}

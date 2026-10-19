import { BackgroundRequest } from "../shared/types";
import { closeReviewSession, openReviewSession } from "../shared/review-session";

chrome.tabs.onRemoved.addListener((tabId) => {
  void closeReviewSession(tabId).catch(console.warn);
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isBackgroundMessage(message)) return;

  void handleBackgroundMessage(message, sender.tab?.id)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

export async function handleBackgroundMessage(
  message: BackgroundRequest,
  sourceTabId: number | undefined
): Promise<{ ok: true; sessionId: string }> {
  if (sourceTabId == null) throw new Error("No source tab for this capture.");
  const sessionId = await openReviewSession(sourceTabId, message.captureId);
  return { ok: true, sessionId };
}

export function isBackgroundMessage(message: unknown): message is BackgroundRequest {
  if (!message || typeof message !== "object") return false;
  const candidate = message as { type?: unknown; captureId?: unknown };
  return candidate.type === "OPEN_REVIEW" && typeof candidate.captureId === "string";
}

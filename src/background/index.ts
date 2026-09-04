import { RuntimeResponse } from "../shared/types";
import { closeReviewSession, finishManualSelection, openReviewSession } from "../shared/review-session";

type BackgroundMessage =
  | { type: "OPEN_REVIEW" }
  | { type: "COMPLETE_MANUAL_SELECTION"; sessionId: string; response: RuntimeResponse }
  | { type: "FAIL_MANUAL_SELECTION"; sessionId: string; error: string };

chrome.tabs.onRemoved.addListener((tabId) => {
  void closeReviewSession(tabId).catch(console.warn);
});

chrome.runtime.onMessage.addListener((message: BackgroundMessage, sender, sendResponse) => {
  if (!isBackgroundMessage(message)) return;

  void handleBackgroundMessage(message, sender.tab?.id)
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

export async function handleBackgroundMessage(
  message: BackgroundMessage,
  sourceTabId: number | undefined
): Promise<{ ok: true; sessionId?: string }> {
  if (message.type === "OPEN_REVIEW") {
    if (sourceTabId == null) throw new Error("No source tab for this selection.");
    const sessionId = await openReviewSession(sourceTabId, true);
    return { ok: true, sessionId };
  }

  if (message.type === "COMPLETE_MANUAL_SELECTION") {
    await finishManualSelection(message.sessionId, sourceTabId, message.response);
    return { ok: true };
  }

  await finishManualSelection(message.sessionId, sourceTabId, { ok: false, error: message.error });
  return { ok: true };
}

function isBackgroundMessage(message: unknown): message is BackgroundMessage {
  if (!message || typeof message !== "object" || !("type" in message)) return false;
  if (message.type === "OPEN_REVIEW") return true;
  return "sessionId" in message && typeof message.sessionId === "string" &&
    (message.type === "COMPLETE_MANUAL_SELECTION" || message.type === "FAIL_MANUAL_SELECTION");
}

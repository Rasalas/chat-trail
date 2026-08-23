import { RuntimeResponse } from "../shared/types";

type BackgroundMessage =
  | { type: "OPEN_REVIEW" }
  | { type: "COMPLETE_MANUAL_SELECTION"; response: RuntimeResponse }
  | { type: "FAIL_MANUAL_SELECTION"; error: string };

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
): Promise<{ ok: true }> {
  if (message.type === "OPEN_REVIEW") {
    await chrome.storage.session.remove(["manualSelection", "manualSelectionError"]);
    await chrome.storage.session.set({
      ...(sourceTabId == null ? {} : { sourceTabId }),
      manualSelectionPending: { state: "extracting" }
    });
    await chrome.tabs.create({ url: chrome.runtime.getURL("src/review/index.html") });
    return { ok: true };
  }

  if (message.type === "COMPLETE_MANUAL_SELECTION") {
    await chrome.storage.session.set({ manualSelection: message.response });
    await chrome.storage.session.remove(["manualSelectionPending", "manualSelectionError"]);
    return { ok: true };
  }

  await chrome.storage.session.set({ manualSelectionError: message.error });
  await chrome.storage.session.remove(["manualSelection", "manualSelectionPending"]);
  return { ok: true };
}

function isBackgroundMessage(message: { type?: string }): message is BackgroundMessage {
  return ["OPEN_REVIEW", "COMPLETE_MANUAL_SELECTION", "FAIL_MANUAL_SELECTION"].includes(message.type ?? "");
}

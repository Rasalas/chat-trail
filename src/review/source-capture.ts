import { ReviewSession } from "../shared/review-session";
import { readableTabError, sendToTabWithContentScript } from "../shared/tabs";
import { ContentRequest, RuntimeResponse } from "../shared/types";

export const SOURCE_CLOSED = "The source tab was closed. Open Chat Trail from the chat again.";
export const SOURCE_RELOADED = "The source tab was reloaded or navigated, so this capture is gone. Open Chat Trail from the chat again.";

export async function fetchCapture(session: ReviewSession): Promise<RuntimeResponse> {
  await requireSourceTab(session.sourceTabId);
  const request: ContentRequest = { type: "GET_CAPTURE_RESULT", captureId: session.captureId };
  try {
    // No re-injection: a fresh content script would not hold the capture anyway.
    const response = (await chrome.tabs.sendMessage(session.sourceTabId, request)) as RuntimeResponse | undefined;
    if (!response) throw new Error(SOURCE_RELOADED);
    return response;
  } catch (error) {
    throw await sourceError(session.sourceTabId, error);
  }
}

/** Captures in the source tab while it is visible and focused, then returns to this review tab. */
export async function captureInSourceTab(sourceTabId: number, useProviderCopy: boolean): Promise<string> {
  const source = await requireSourceTab(sourceTabId);
  const review = await chrome.tabs.getCurrent();
  try {
    // Hidden tabs get no scroll/rAF/IntersectionObserver updates, so virtualised chats would not render.
    await chrome.tabs.update(sourceTabId, { active: true });
    await chrome.windows.update(source.windowId, { focused: true });
    const response = await sendToTabWithContentScript(sourceTabId, { type: "RUN_CAPTURE", useProviderCopy });
    if (!response.ok) throw new Error(response.error);
    return response.captureId;
  } catch (error) {
    throw await sourceError(sourceTabId, error);
  } finally {
    if (review?.id != null) {
      await chrome.tabs.update(review.id, { active: true }).catch(() => undefined);
      await chrome.windows.update(review.windowId, { focused: true }).catch(() => undefined);
    }
  }
}

async function requireSourceTab(tabId: number): Promise<chrome.tabs.Tab> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab) return tab;
  } catch {
    // Closed tabs reject with "No tab with id".
  }
  throw new Error(SOURCE_CLOSED);
}

async function sourceError(tabId: number, error: unknown): Promise<Error> {
  const message = error instanceof Error ? error.message : String(error);
  if (message === SOURCE_RELOADED) return new Error(message);
  if (!(await chrome.tabs.get(tabId).catch(() => undefined))) return new Error(SOURCE_CLOSED);
  // Reloads and navigations drop the content script and the activeTab grant.
  if (/Receiving end does not exist|Could not establish connection|message port closed|Cannot access|Cannot read this tab/i.test(message)) {
    return new Error(SOURCE_RELOADED);
  }
  return readableTabError(error);
}

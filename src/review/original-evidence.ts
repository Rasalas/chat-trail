import { sendToTabWithContentScript } from "../shared/tabs";

export async function captureOriginalEvidence(tabId: number, expectedUrl: string): Promise<{ htmlSnapshot: string; screenshotDataUrl: string }> {
  const tab = await chrome.tabs.get(tabId);
  if (!expectedUrl || tab.url !== expectedUrl) throw new Error("The source page has changed. Refresh the review before including the original page.");
  const response = await sendToTabWithContentScript(tabId, { type: "GET_HTML_SNAPSHOT", expectedUrl });
  if (!response.ok) throw new Error(response.error);

  const [reviewTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await new Promise((resolve) => window.setTimeout(resolve, 150));
    await verifyActiveSource(tabId, tab.windowId, expectedUrl);
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    await verifyActiveSource(tabId, tab.windowId, expectedUrl);
    return { htmlSnapshot: response.html, screenshotDataUrl };
  } finally {
    if (reviewTab?.id != null) {
      await chrome.tabs.update(reviewTab.id, { active: true }).catch(() => undefined);
      await chrome.windows.update(reviewTab.windowId, { focused: true }).catch(() => undefined);
    }
  }
}

async function verifyActiveSource(tabId: number, windowId: number, url: string): Promise<void> {
  const [active] = await chrome.tabs.query({ active: true, windowId });
  if (active?.id !== tabId || active.url !== url) throw new Error("The active page changed during the screenshot. Please try again.");
}

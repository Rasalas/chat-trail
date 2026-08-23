chrome.runtime.onMessage.addListener((message: { type?: string }, sender, sendResponse) => {
  if (message.type !== "OPEN_REVIEW") return;

  void openReview(sender.tab?.id)
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

async function openReview(sourceTabId: number | undefined): Promise<void> {
  if (sourceTabId != null) await chrome.storage.session.set({ sourceTabId });
  await chrome.tabs.create({ url: chrome.runtime.getURL("src/review/index.html") });
}

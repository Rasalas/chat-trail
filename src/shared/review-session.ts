import { RuntimeResponse } from "./types";

export interface ReviewSession {
  sourceTabId: number;
  state: "ready" | "extracting" | "failed";
  response?: RuntimeResponse;
  error?: string;
}

const sessionKey = (id: string) => `review:${id}`;
const tabKey = (id: number) => `review-tab:${id}`;

export async function openReviewSession(sourceTabId: number, manualSelection = false): Promise<string> {
  const id = crypto.randomUUID();
  await chrome.storage.session.set({ [sessionKey(id)]: { sourceTabId, state: manualSelection ? "extracting" : "ready" } });
  try {
    const url = new URL(chrome.runtime.getURL("src/review/index.html"));
    url.searchParams.set("session", id);
    const tab = await chrome.tabs.create({ url: url.href });
    if (tab.id != null) await chrome.storage.session.set({ [tabKey(tab.id)]: id });
    return id;
  } catch (error) {
    await chrome.storage.session.remove(sessionKey(id));
    throw error;
  }
}

export async function readReviewSession(id: string | null): Promise<ReviewSession> {
  if (!id) throw new Error("No review session. Open Chat Trail from the source page again.");
  const stored = await chrome.storage.session.get(sessionKey(id));
  const session = stored[sessionKey(id)] as ReviewSession | undefined;
  if (!session) throw new Error("This review session has expired. Open Chat Trail from the source page again.");
  return session;
}

export async function finishManualSelection(id: string, sourceTabId: number | undefined, result: RuntimeResponse): Promise<void> {
  const session = await readReviewSession(id);
  if (session.sourceTabId !== sourceTabId || session.state !== "extracting") {
    throw new Error("The selection does not belong to this pending review.");
  }
  await chrome.storage.session.set({ [sessionKey(id)]: {
    ...session,
    state: result.ok ? "ready" : "failed",
    response: result.ok ? result : undefined,
    error: result.ok ? undefined : result.error
  } });
}

export async function closeReviewSession(reviewTabId: number): Promise<void> {
  const stored = await chrome.storage.session.get(tabKey(reviewTabId));
  const id = stored[tabKey(reviewTabId)];
  if (typeof id === "string") await chrome.storage.session.remove([sessionKey(id), tabKey(reviewTabId)]);
}

import { RuntimeResponse } from "./types";

export async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

export async function sendToTabWithContentScript(tabId: number, message: object): Promise<RuntimeResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!isMissingReceiverError(error)) throw readableTabError(error);
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["assets/content.js"]
    });
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    throw readableTabError(error);
  }
}

export function readableTabError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/Cannot access|chrome:\/\/|edge:\/\/|extensions gallery|Receiving end does not exist/i.test(message)) {
    return new Error("Cannot read this tab. Open or reload a normal web page, then try again.");
  }
  return new Error(message);
}

function isMissingReceiverError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|Could not establish connection/i.test(message);
}

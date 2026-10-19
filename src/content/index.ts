import { selectAdapter } from "../adapters";
import { extractFromContainer } from "../adapters/generic";
import { blobFromText, downloadBlob } from "../shared/download";
import { ContentRequest, ExportOptions } from "../shared/types";
import { pickContainer } from "./container-picker";
import { createContentController } from "./controller";
import { claimContentScript } from "./guard";
import { createPill } from "./progress-pill";
import { extractWithScrollCapture } from "./scroll-capture";
import { snapshotDocument } from "./snapshot";

if (claimContentScript()) {
  const controller = createContentController({
    async capture({ useProviderCopy, signal, onProgress }) {
      const adapter = selectAdapter(new URL(document.location.href), document);
      const conversation = await extractWithScrollCapture(adapter, document, { useProviderCopy, signal, onProgress });
      return { ok: true, conversation, adapterId: adapter.id, adapterLabel: adapter.label };
    },
    pickContainer,
    extractContainer: (container) => extractFromContainer(container, document),
    snapshotHtml: () => snapshotDocument(document),
    currentUrl: () => document.location.href,
    sendBackground: (message) => chrome.runtime.sendMessage(message),
    download: (text, filename) => downloadBlob(blobFromText(text, "text/markdown;charset=utf-8"), filename),
    writeClipboard,
    async storedOptions() {
      const stored = await chrome.storage.sync.get("exportOptions");
      return (stored.exportOptions ?? {}) as Partial<ExportOptions>;
    },
    createPill: (handlers) => createPill(document, handlers),
    newId: () => crypto.randomUUID()
  });

  chrome.runtime.onMessage.addListener((message: ContentRequest, _sender, sendResponse) => {
    controller
      .handleMessage(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });
    return true;
  });
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through: execCommand works inside a click handler even when the async API is refused.
  }
  const previousFocus = document.activeElement as HTMLElement | null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.documentElement.append(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  previousFocus?.focus?.();
  if (!copied) throw new Error("The browser blocked clipboard access. Click “Copy to clipboard” to try again.");
}

import { selectAdapter } from "../adapters";
import { extractFromContainer } from "../adapters/generic";
import { extractWithScrollCapture } from "./scroll-capture";
import { RuntimeResponse } from "../shared/types";

type RuntimeMessage =
  | { type: "EXTRACT_CONVERSATION"; useProviderCopy?: boolean }
  | { type: "GET_HTML_SNAPSHOT" }
  | { type: "START_CONTAINER_SELECTION" };

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

async function handleMessage(
  message: RuntimeMessage
): Promise<RuntimeResponse | { ok: true; html: string } | { ok: true; selecting: true }> {
  if (message.type === "GET_HTML_SNAPSHOT") {
    return { ok: true, html: snapshotHtml() };
  }

  if (message.type === "START_CONTAINER_SELECTION") {
    void selectContainerAndOpenReview();
    return { ok: true, selecting: true };
  }

  const adapter = selectAdapter(new URL(document.location.href), document);
  const conversation = await extractWithScrollCapture(adapter, document, { useProviderCopy: Boolean(message.useProviderCopy) });
  return {
    ok: true,
    conversation,
    adapterId: adapter.id,
    adapterLabel: adapter.label
  };
}

async function selectContainerAndOpenReview(): Promise<void> {
  try {
    const container = await pickContainer();
    await sendBackgroundMessage({ type: "OPEN_REVIEW" });
    const conversation = await extractFromContainer(container, document);
    await sendBackgroundMessage({
      type: "COMPLETE_MANUAL_SELECTION",
      response: {
        ok: true,
        conversation,
        adapterId: "generic",
        adapterLabel: "Selected web content"
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "Container selection cancelled.") return;
    const message = error instanceof Error ? error.message : String(error);
    try {
      await sendBackgroundMessage({ type: "FAIL_MANUAL_SELECTION", error: message });
    } catch (notificationError) {
      console.warn("Could not report container selection failure.", notificationError);
    }
    console.warn("Container selection failed.", error);
  }
}

async function sendBackgroundMessage(message: object): Promise<void> {
  const response = (await chrome.runtime.sendMessage(message)) as { ok?: boolean; error?: string } | undefined;
  if (!response?.ok) throw new Error(response?.error || "The extension background service did not respond.");
}

export function snapshotHtml(): string {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll("script, noscript, template, link[rel='preload'][as='script']")
    .forEach((element) => element.remove());
  return `<!doctype html>\n${clone.outerHTML}`;
}

function pickContainer(): Promise<Element> {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    const label = document.createElement("div");
    const cancel = document.createElement("button");
    let current: Element | null = null;

    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "pointer-events:none",
      "outline:9999px solid rgba(15, 23, 42, 0.18)",
      "border:2px solid #0d6b57",
      "display:none",
      "pointer-events:none"
    ].join(";");

    label.append("Select a chat area", cancel);
    cancel.type = "button";
    cancel.textContent = "Cancel";
    label.style.cssText = [
      "position:fixed",
      "left:16px",
      "bottom:16px",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "gap:12px",
      "padding:9px 10px 9px 12px",
      "border-radius:9px",
      "background:#171717",
      "color:#fffefa",
      "font:12px ui-monospace, SFMono-Regular, Menlo, monospace",
      "box-shadow:0 8px 24px rgba(0,0,0,.22)",
      "pointer-events:auto"
    ].join(";");
    cancel.style.cssText = [
      "min-height:0",
      "padding:4px 8px",
      "border:1px solid rgba(255,255,255,.35)",
      "border-radius:6px",
      "background:transparent",
      "color:#fffefa",
      "font:inherit",
      "cursor:pointer"
    ].join(";");

    document.documentElement.append(overlay, label);
    const previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "crosshair";

    const cleanup = () => {
      overlay.remove();
      label.remove();
      document.documentElement.style.cursor = previousCursor;
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
    };

    const onMove = (event: MouseEvent) => {
      if (event.target instanceof Node && cancel.contains(event.target)) return;
      const target = event.target instanceof Element ? event.target.closest("article, [role='listitem'], main, section, div") : null;
      if (!target || target === document.documentElement || target === document.body) return;
      current = target;
      const rect = target.getBoundingClientRect();
      overlay.style.display = "block";
      overlay.style.left = `${rect.left}px`;
      overlay.style.top = `${rect.top}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.right = "auto";
      overlay.style.bottom = "auto";
    };

    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Node && cancel.contains(event.target)) {
        event.preventDefault();
        event.stopPropagation();
        cleanup();
        reject(new Error("Container selection cancelled."));
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.target instanceof Element) {
        const target = event.target.closest("article, [role='listitem'], main, section, div");
        if (target && target !== document.documentElement && target !== document.body) current = target;
      }
      cleanup();
      if (current) resolve(current);
      else reject(new Error("No container selected."));
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cleanup();
        reject(new Error("Container selection cancelled."));
      }
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
  });
}

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

async function handleMessage(message: RuntimeMessage): Promise<RuntimeResponse | { ok: true; html: string }> {
  if (message.type === "GET_HTML_SNAPSHOT") {
    return { ok: true, html: document.documentElement.outerHTML };
  }

  if (message.type === "START_CONTAINER_SELECTION") {
    const container = await pickContainer();
    const conversation = await extractFromContainer(container, document);
    return {
      ok: true,
      conversation,
      adapterId: "generic",
      adapterLabel: "Generic Web Chat"
    };
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

function pickContainer(): Promise<Element> {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    const label = document.createElement("div");
    let current: Element | null = null;

    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "pointer-events:none",
      "outline:9999px solid rgba(15, 23, 42, 0.18)",
      "border:2px solid #0d6b57",
      "display:none"
    ].join(";");

    label.textContent = "Click a chat message or container. Esc cancels.";
    label.style.cssText = [
      "position:fixed",
      "left:16px",
      "bottom:16px",
      "z-index:2147483647",
      "padding:10px 12px",
      "border-radius:6px",
      "background:#171717",
      "color:#fffefa",
      "font:12px ui-monospace, SFMono-Regular, Menlo, monospace",
      "box-shadow:0 8px 24px rgba(0,0,0,.22)"
    ].join(";");

    document.documentElement.append(overlay, label);

    const cleanup = () => {
      overlay.remove();
      label.remove();
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
    };

    const onMove = (event: MouseEvent) => {
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
      event.preventDefault();
      event.stopPropagation();
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

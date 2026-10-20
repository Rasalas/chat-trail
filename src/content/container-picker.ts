import { SELECTION_CANCELLED } from "./controller";

const CANDIDATE_SELECTOR = "article, [role='listitem'], main, section, div";
const SWALLOWED_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "auxclick", "contextmenu"] as const;

export function pickContainer(): Promise<Element> {
  return new Promise((resolve, reject) => {
    const overlay = document.createElement("div");
    const label = document.createElement("div");
    const hint = document.createElement("span");
    const cancel = document.createElement("button");
    let current: Element | null = null;
    // Elements stepped through with ArrowUp, so ArrowDown can return.
    let descendants: Element[] = [];

    overlay.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "pointer-events:none",
      "outline:9999px solid rgba(15, 23, 42, 0.18)",
      "border:2px solid #0d6b57",
      "display:none"
    ].join(";");

    hint.textContent = "Select a chat area · ↑/↓ expand · Enter select · Esc cancel";
    label.setAttribute("role", "status");
    label.append(hint, cancel);
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

    const highlight = (target: Element) => {
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

    const finish = (result: Element | Error) => {
      cleanup();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    const isOwnControl = (target: EventTarget | null) => target instanceof Node && label.contains(target);

    const onMove = (event: MouseEvent) => {
      if (isOwnControl(event.target)) return;
      const target = candidateFor(event.target);
      if (!target || target === current) return;
      descendants = [];
      highlight(target);
    };

    // The page must not react to presses that only select an area.
    const swallow = (event: Event) => {
      if (isOwnControl(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const onClick = (event: MouseEvent) => {
      if (isOwnControl(event.target)) {
        if (event.target instanceof Node && cancel.contains(event.target)) {
          event.preventDefault();
          event.stopPropagation();
          finish(new Error(SELECTION_CANCELLED));
        }
        return;
      }
      swallow(event);
      if (event.button !== 0) return;
      const target = current ?? candidateFor(event.target);
      finish(target ?? new Error("No container selected."));
    };

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        swallow(event);
        finish(new Error(SELECTION_CANCELLED));
        return;
      }
      if (event.key === "Enter" && current) {
        swallow(event);
        finish(current);
        return;
      }
      if (event.key === "ArrowUp" && current) {
        swallow(event);
        const parent = candidateFor(current.parentElement);
        if (parent) {
          descendants.push(current);
          highlight(parent);
        }
        return;
      }
      if (event.key === "ArrowDown" && current) {
        swallow(event);
        const child = descendants.pop();
        if (child) highlight(child);
      }
    };

    const cleanup = () => {
      overlay.remove();
      label.remove();
      document.documentElement.style.cursor = previousCursor;
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("keydown", onKey, true);
      for (const type of SWALLOWED_EVENTS) {
        window.removeEventListener(type, type === "click" ? (onClick as EventListener) : swallow, true);
      }
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("keydown", onKey, true);
    for (const type of SWALLOWED_EVENTS) {
      window.addEventListener(type, type === "click" ? (onClick as EventListener) : swallow, true);
    }
  });
}

function candidateFor(target: EventTarget | Element | null): Element | null {
  const element = target instanceof Element ? target.closest(CANDIDATE_SELECTOR) : null;
  if (!element || element === element.ownerDocument.documentElement || element === element.ownerDocument.body) return null;
  return element;
}

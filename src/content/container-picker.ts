import { SELECTION_CANCELLED } from "./controller";

export function pickContainer(): Promise<Element> {
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
        reject(new Error(SELECTION_CANCELLED));
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
        reject(new Error(SELECTION_CANCELLED));
      }
    };

    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
  });
}

export type PillState =
  | { kind: "loading"; round: number }
  | { kind: "reading"; count: number }
  | { kind: "working"; text: string }
  | { kind: "done"; text: string }
  | { kind: "warning"; text: string }
  | { kind: "error"; text: string }
  | { kind: "copy"; text: string };

export interface PillView {
  text: string;
  tone: "busy" | "ok" | "warning" | "error";
  cancel: boolean;
  copy: boolean;
  dismiss: boolean;
  autoHideMs?: number;
}

export function pillView(state: PillState): PillView {
  const base = { cancel: false, copy: false, dismiss: true };
  switch (state.kind) {
    case "loading":
      return { ...base, text: `Loading older messages… (pass ${state.round})`, tone: "busy", cancel: true, dismiss: false };
    case "reading":
      return { ...base, text: `Reading messages… ${state.count}`, tone: "busy", cancel: true, dismiss: false };
    case "working":
      return { ...base, text: state.text, tone: "busy", dismiss: false };
    case "done":
      return { ...base, text: state.text, tone: "ok", autoHideMs: 4000 };
    case "warning":
      return { ...base, text: state.text, tone: "warning" };
    case "error":
      return { ...base, text: state.text, tone: "error" };
    case "copy":
      return { ...base, text: state.text, tone: "warning", copy: true };
  }
}

export interface PillHandle {
  show(state: PillState): void;
  hide(): void;
}

const STYLE = `
:host { all: initial; }
.pill { position: fixed; right: 16px; top: 72px; z-index: 2147483647; display: flex; align-items: center; gap: 10px;
  max-width: min(420px, calc(100vw - 32px)); padding: 9px 10px 9px 12px; border-radius: 9px; background: #171717; color: #fffefa;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; box-shadow: 0 8px 24px rgba(0,0,0,.22); }
.dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 50%; background: #35a08a; }
.busy .dot { animation: pulse 1s ease-in-out infinite alternate; }
.warning .dot { background: #e0a030; }
.error .dot { background: #d47b6c; }
.text { flex: 1 1 auto; overflow-wrap: anywhere; }
button { flex: 0 0 auto; padding: 4px 8px; border: 1px solid rgba(255,255,255,.35); border-radius: 6px; background: transparent;
  color: inherit; font: inherit; cursor: pointer; }
button:hover { background: rgba(255,255,255,.1); }
button:focus-visible { outline: 2px solid #35a08a; outline-offset: 2px; }
button[hidden] { display: none; }
@keyframes pulse { from { opacity: 1; } to { opacity: .35; } }
@media (prefers-reduced-motion: reduce) { .busy .dot { animation: none; } }
`;

export function createPill(document: Document, handlers: { onCancel(): void; onCopy(): void }): PillHandle {
  let host: HTMLElement | null = null;
  let parts: { pill: HTMLElement; text: HTMLElement; cancel: HTMLButtonElement; copy: HTMLButtonElement; close: HTMLButtonElement } | null = null;
  let hideTimer: number | undefined;

  const build = () => {
    host = document.createElement("div");
    host.setAttribute("data-chat-trail", "progress");
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    const pill = document.createElement("div");
    pill.setAttribute("role", "status");
    pill.setAttribute("aria-live", "polite");
    pill.setAttribute("aria-atomic", "true");
    const dot = document.createElement("span");
    dot.className = "dot";
    const text = document.createElement("span");
    text.className = "text";
    const button = (label: string, onClick: () => void) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = label;
      element.addEventListener("click", onClick);
      return element;
    };
    const cancel = button("Cancel", handlers.onCancel);
    const copy = button("Copy to clipboard", handlers.onCopy);
    const close = button("Close", () => hide());
    close.setAttribute("aria-label", "Close Chat Trail status");
    pill.append(dot, text, copy, cancel, close);
    root.append(style, pill);
    document.documentElement.append(host);
    parts = { pill, text, cancel, copy, close };
  };

  const hide = () => {
    window.clearTimeout(hideTimer);
    host?.remove();
    host = null;
    parts = null;
  };

  const show = (state: PillState) => {
    window.clearTimeout(hideTimer);
    if (!host?.isConnected) build();
    const view = pillView(state);
    parts!.pill.className = `pill ${view.tone}`;
    parts!.text.textContent = `Chat Trail · ${view.text}`;
    parts!.cancel.hidden = !view.cancel;
    parts!.copy.hidden = !view.copy;
    parts!.close.hidden = !view.dismiss;
    if (view.autoHideMs) hideTimer = window.setTimeout(hide, view.autoHideMs);
  };

  return { show, hide };
}

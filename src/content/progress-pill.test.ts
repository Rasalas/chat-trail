import { afterEach, describe, expect, it, vi } from "vitest";
import { createPill, pillView } from "./progress-pill";

describe("pillView", () => {
  it("offers cancel only while a capture is running", () => {
    expect(pillView({ kind: "loading", round: 3 })).toMatchObject({ text: "Loading older messages… (pass 3)", tone: "busy", cancel: true, dismiss: false });
    expect(pillView({ kind: "reading", count: 80 })).toMatchObject({ text: "Reading messages… 80", cancel: true });
    expect(pillView({ kind: "working", text: "Opening review…" })).toMatchObject({ cancel: false, dismiss: false });
  });

  it("auto-hides success but keeps warnings, errors and copy prompts until dismissed", () => {
    expect(pillView({ kind: "done", text: "Saved." }).autoHideMs).toBeGreaterThan(0);
    for (const kind of ["warning", "error", "copy"] as const) {
      const view = pillView({ kind, text: "x" });
      expect(view.autoHideMs).toBeUndefined();
      expect(view.dismiss).toBe(true);
    }
    expect(pillView({ kind: "copy", text: "x" }).copy).toBe(true);
  });
});

describe("createPill", () => {
  afterEach(() => vi.useRealTimers());

  it("renders into a single shadow host and hides after success", () => {
    vi.useFakeTimers();
    const onCancel = vi.fn();
    const pill = createPill(document, { onCancel, onCopy: vi.fn() });
    pill.show({ kind: "reading", count: 4 });
    pill.show({ kind: "reading", count: 9 });
    expect(document.querySelectorAll("[data-chat-trail='progress']")).toHaveLength(1);
    pill.show({ kind: "done", text: "Saved." });
    vi.runAllTimers();
    expect(document.querySelector("[data-chat-trail='progress']")).toBeNull();
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeConversation } from "../testing/fixtures";

const addListener = vi.fn();
const remove = vi.fn(async () => undefined);
const set = vi.fn(async () => undefined);
const create = vi.fn(async () => undefined);

vi.stubGlobal("chrome", {
  runtime: {
    getURL: (path: string) => `chrome-extension://test/${path}`,
    onMessage: { addListener }
  },
  storage: { session: { remove, set } },
  tabs: { create }
});

const { handleBackgroundMessage } = await import("./index");

describe("manual selection background flow", () => {
  beforeEach(() => {
    remove.mockClear();
    set.mockClear();
    create.mockClear();
  });

  it("stores the pending state before opening the review tab", async () => {
    await handleBackgroundMessage({ type: "OPEN_REVIEW" }, 42);

    expect(remove).toHaveBeenCalledWith(["manualSelection", "manualSelectionError"]);
    expect(set).toHaveBeenCalledWith({
      sourceTabId: 42,
      manualSelectionPending: { state: "extracting" }
    });
    expect(create).toHaveBeenCalledWith({ url: "chrome-extension://test/src/review/index.html" });
    expect(set.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
  });

  it("stores the extracted selection for the waiting review page", async () => {
    const response = {
      ok: true as const,
      conversation: makeConversation([]),
      adapterId: "generic" as const,
      adapterLabel: "Selected web content"
    };

    await handleBackgroundMessage({ type: "COMPLETE_MANUAL_SELECTION", response }, 42);

    expect(set).toHaveBeenCalledWith({ manualSelection: response });
    expect(remove).toHaveBeenCalledWith(["manualSelectionPending", "manualSelectionError"]);
  });
});

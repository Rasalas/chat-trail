import { beforeEach, describe, expect, it, vi } from "vitest";

const stored: Record<string, unknown> = {};
let nextTabId = 100;
const get = vi.fn(async (key: string) => ({ [key]: structuredClone(stored[key]) }));
const set = vi.fn(async (values: object) => { Object.assign(stored, structuredClone(values)); });
const remove = vi.fn(async (keys: string | string[]) => { for (const key of [keys].flat()) delete stored[key]; });
const create = vi.fn(async () => ({ id: nextTabId++ }));
vi.stubGlobal("chrome", {
  runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, onMessage: { addListener: vi.fn() } },
  storage: { session: { get, set, remove } },
  tabs: { create, onRemoved: { addListener: vi.fn() } }
});
const { handleBackgroundMessage, isBackgroundMessage } = await import("./index");
const { readReviewSession, openReviewSession, closeReviewSession, updateReviewCapture } = await import("../shared/review-session");

describe("review sessions", () => {
  beforeEach(() => {
    for (const key of Object.keys(stored)) delete stored[key];
    vi.clearAllMocks();
    nextTabId = 100;
  });

  it("stores the capture reference before opening the review with its session id", async () => {
    const { sessionId } = await handleBackgroundMessage({ type: "OPEN_REVIEW", captureId: "cap-1" }, 42);
    expect(await readReviewSession(sessionId)).toEqual({ sourceTabId: 42, captureId: "cap-1" });
    expect(create).toHaveBeenCalledWith({ url: `chrome-extension://test/src/review/index.html?session=${sessionId}` });
    expect(set.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
  });

  it("keeps only small metadata in session storage", async () => {
    await handleBackgroundMessage({ type: "OPEN_REVIEW", captureId: "cap-1" }, 42);
    expect(JSON.stringify(stored).length).toBeLessThan(300);
  });

  it("rejects review requests without a source tab", async () => {
    await expect(handleBackgroundMessage({ type: "OPEN_REVIEW", captureId: "cap-1" }, undefined)).rejects.toThrow("No source tab");
    expect(create).not.toHaveBeenCalled();
  });

  it("accepts only well-formed background messages", () => {
    expect(isBackgroundMessage({ type: "OPEN_REVIEW", captureId: "x" })).toBe(true);
    expect(isBackgroundMessage({ type: "OPEN_REVIEW" })).toBe(false);
    expect(isBackgroundMessage({ type: "COMPLETE_MANUAL_SELECTION", sessionId: "x" })).toBe(false);
    expect(isBackgroundMessage(null)).toBe(false);
  });

  it("points a session at a newer capture after a refresh", async () => {
    const id = await openReviewSession(42, "cap-1");
    await updateReviewCapture(id, "cap-2");
    expect(await readReviewSession(id)).toEqual({ sourceTabId: 42, captureId: "cap-2" });
  });

  it("cleans up only the closed review and rejects missing sessions", async () => {
    const a = await openReviewSession(42, "cap-a");
    const b = await openReviewSession(43, "cap-b");
    await closeReviewSession(100);
    await expect(readReviewSession(a)).rejects.toThrow("expired");
    expect((await readReviewSession(b)).sourceTabId).toBe(43);
    await expect(readReviewSession(null)).rejects.toThrow("No review session");
  });
});

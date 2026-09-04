import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeConversation } from "../testing/fixtures";

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
const { handleBackgroundMessage } = await import("./index");
const { readReviewSession, openReviewSession, closeReviewSession } = await import("../shared/review-session");

const response = { ok: true as const, conversation: makeConversation([]), adapterId: "generic" as const, adapterLabel: "Selected web content" };

describe("review sessions", () => {
  beforeEach(() => {
    for (const key of Object.keys(stored)) delete stored[key];
    vi.clearAllMocks();
    nextTabId = 100;
  });

  it("stores the pending state before opening the review with its session id", async () => {
    const { sessionId } = await handleBackgroundMessage({ type: "OPEN_REVIEW" }, 42);
    expect(await readReviewSession(sessionId!)).toEqual({ sourceTabId: 42, state: "extracting" });
    expect(create).toHaveBeenCalledWith({ url: `chrome-extension://test/src/review/index.html?session=${sessionId}` });
    expect(set.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
  });

  it("keeps normal reviews and out-of-order manual selections isolated", async () => {
    const normal = await openReviewSession(10);
    const a = (await handleBackgroundMessage({ type: "OPEN_REVIEW" }, 42)).sessionId!;
    const b = (await handleBackgroundMessage({ type: "OPEN_REVIEW" }, 43)).sessionId!;
    await handleBackgroundMessage({ type: "COMPLETE_MANUAL_SELECTION", sessionId: b, response }, 43);
    await handleBackgroundMessage({ type: "FAIL_MANUAL_SELECTION", sessionId: a, error: "Selection failed" }, 42);
    expect(await readReviewSession(normal)).toEqual({ sourceTabId: 10, state: "ready" });
    expect(await readReviewSession(b)).toMatchObject({ sourceTabId: 43, state: "ready", response });
    expect(await readReviewSession(a)).toMatchObject({ sourceTabId: 42, state: "failed", error: "Selection failed" });
  });

  it("rejects results from a different source tab", async () => {
    const sessionId = (await handleBackgroundMessage({ type: "OPEN_REVIEW" }, 42)).sessionId!;
    await expect(handleBackgroundMessage({ type: "COMPLETE_MANUAL_SELECTION", sessionId, response }, 43)).rejects.toThrow("does not belong");
    expect((await readReviewSession(sessionId)).state).toBe("extracting");
  });

  it("cleans up only the closed review and rejects missing sessions", async () => {
    const a = await openReviewSession(42);
    const b = await openReviewSession(43);
    await closeReviewSession(100);
    await expect(readReviewSession(a)).rejects.toThrow("expired");
    expect((await readReviewSession(b)).sourceTabId).toBe(43);
    await expect(readReviewSession(null)).rejects.toThrow("No review session");
  });
});

import { describe, expect, it, vi } from "vitest";
import { makeConversation, makeMessage } from "../testing/fixtures";
import { ContentDeps, CAPTURE_CANCELLED, CAPTURE_GONE, SELECTION_CANCELLED, createContentController } from "./controller";
import { PillState } from "./progress-pill";
import { ExtractionResult, RuntimeResponse } from "../shared/types";

vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "test" }) } });

const conversation = makeConversation([
  makeMessage("user", 0, [{ type: "text", text: "Question" }]),
  makeMessage("assistant", 1, [{ type: "text", text: "Answer" }])
]);
const result: ExtractionResult = { ok: true, conversation, adapterId: "generic", adapterLabel: "Test" };

function setup(overrides: Partial<ContentDeps> = {}) {
  const states: PillState[] = [];
  let handlers!: { onCancel(): void; onCopy(): void };
  let id = 0;
  const deps: ContentDeps = {
    capture: vi.fn(async ({ onProgress }) => {
      onProgress({ phase: "reading", count: 2 });
      return structuredClone(result);
    }),
    pickContainer: vi.fn(async () => document.createElement("div")),
    extractContainer: vi.fn(async () => structuredClone(conversation)),
    snapshotHtml: () => "<p>snapshot</p>",
    currentUrl: () => "https://example.com/chat/a",
    sendBackground: vi.fn(async () => ({ ok: true, sessionId: "session" })),
    download: vi.fn(),
    writeClipboard: vi.fn(async () => undefined),
    storedOptions: vi.fn(async () => ({})),
    createPill: (pillHandlers) => {
      handlers = pillHandlers;
      return { show: (state) => states.push(state), hide: vi.fn() };
    },
    newId: () => `cap-${++id}`,
    ...overrides
  };
  const controller = createContentController(deps);
  return { deps, controller, states, handlers: () => handlers, last: () => states.at(-1) };
}

function deferredCapture() {
  let signal!: AbortSignal;
  let resolve!: (value: ExtractionResult) => void;
  const capture = vi.fn((options: { signal: AbortSignal }) => {
    signal = options.signal;
    return new Promise<ExtractionResult>((done, fail) => {
      resolve = done;
      signal.addEventListener("abort", () => fail(signal.reason));
    });
  });
  return { capture, resolve: (value: ExtractionResult) => resolve(value), signal: () => signal };
}

describe("content controller", () => {
  it("answers START_CAPTURE immediately and downloads Markdown in the page when done", async () => {
    const pending = deferredCapture();
    const { controller, deps, last } = setup({ capture: pending.capture });
    expect(await controller.handleMessage({ type: "START_CAPTURE", action: "download" })).toEqual({ ok: true, started: true });
    expect(deps.download).not.toHaveBeenCalled();
    pending.resolve(structuredClone(result));
    await vi.waitFor(() => expect(deps.download).toHaveBeenCalledOnce());
    const [markdown, filename] = vi.mocked(deps.download).mock.calls[0];
    expect(markdown).toContain("Answer");
    expect(filename).toBe("test-chat.md");
    expect(last()).toEqual({ kind: "done", text: "Saved 2 messages from Test." });
  });

  it("refuses a second capture while one is running", async () => {
    const pending = deferredCapture();
    const { controller } = setup({ capture: pending.capture });
    await controller.handleMessage({ type: "START_CAPTURE", action: "download" });
    expect(await controller.handleMessage({ type: "START_CAPTURE", action: "copy" })).toMatchObject({ ok: false });
    expect(await controller.handleMessage({ type: "START_CONTAINER_SELECTION" })).toMatchObject({ ok: false });
    expect(pending.capture).toHaveBeenCalledOnce();
  });

  it("cancels a running capture from the pill and reports it", async () => {
    const pending = deferredCapture();
    const { controller, handlers, last } = setup({ capture: pending.capture });
    const running = controller.handleMessage({ type: "RUN_CAPTURE", useProviderCopy: false });
    await vi.waitFor(() => expect(pending.capture).toHaveBeenCalled());
    handlers().onCancel();
    await expect(running).rejects.toThrow(CAPTURE_CANCELLED);
    expect(pending.signal().aborted).toBe(true);
    expect(last()).toEqual({ kind: "done", text: CAPTURE_CANCELLED });
    // The page is free again afterwards.
    expect(await controller.handleMessage({ type: "START_CAPTURE", action: "download" })).toEqual({ ok: true, started: true });
  });

  it("keeps review captures in memory and opens the review with a reference", async () => {
    const { controller, deps } = setup({ storedOptions: vi.fn(async () => ({ useProviderCopy: true })) });
    await controller.handleMessage({ type: "START_CAPTURE", action: "review" });
    await vi.waitFor(() => expect(deps.sendBackground).toHaveBeenCalledWith({ type: "OPEN_REVIEW", captureId: "cap-1" }));
    expect(vi.mocked(deps.capture).mock.calls[0][0].useProviderCopy).toBe(true);
    const fetched = (await controller.handleMessage({ type: "GET_CAPTURE_RESULT", captureId: "cap-1" })) as RuntimeResponse;
    expect(fetched).toEqual(result);
    expect(await controller.handleMessage({ type: "GET_CAPTURE_RESULT", captureId: "missing" })).toEqual({ ok: false, error: CAPTURE_GONE });
  });

  it("returns a capture id for review refreshes and evicts old captures", async () => {
    const { controller } = setup();
    for (let index = 0; index < 6; index += 1) {
      expect(await controller.handleMessage({ type: "RUN_CAPTURE" })).toEqual({ ok: true, captureId: `cap-${index + 1}` });
    }
    expect(await controller.handleMessage({ type: "GET_CAPTURE_RESULT", captureId: "cap-1" })).toEqual({ ok: false, error: CAPTURE_GONE });
    expect(await controller.handleMessage({ type: "GET_CAPTURE_RESULT", captureId: "cap-6" })).toMatchObject({ ok: true });
  });

  it("falls back to a pill button when the clipboard write is refused", async () => {
    const writeClipboard = vi.fn().mockRejectedValueOnce(new Error("Document is not focused.")).mockResolvedValue(undefined);
    const { controller, handlers, last } = setup({ writeClipboard });
    await controller.handleMessage({ type: "START_CAPTURE", action: "copy" });
    await vi.waitFor(() => expect(last()).toEqual({ kind: "copy", text: "2 messages ready." }));
    handlers().onCopy();
    await vi.waitFor(() => expect(last()).toEqual({ kind: "done", text: "Copied 2 messages as Markdown." }));
    expect(writeClipboard).toHaveBeenCalledTimes(2);
    expect(writeClipboard.mock.calls[1][0]).toContain("Answer");
  });

  it("rejects a capture when the page navigates meanwhile", async () => {
    let url = "https://example.com/chat/a";
    const { controller } = setup({
      currentUrl: () => url,
      capture: vi.fn(async () => {
        url = "https://example.com/chat/b";
        return structuredClone(result);
      })
    });
    await expect(controller.handleMessage({ type: "RUN_CAPTURE" })).rejects.toThrow("source page changed");
  });

  it("extracts a selected container before opening the review, and ignores a cancelled selection", async () => {
    const { controller, deps } = setup();
    expect(await controller.handleMessage({ type: "START_CONTAINER_SELECTION" })).toEqual({ ok: true, selecting: true });
    await vi.waitFor(() => expect(deps.sendBackground).toHaveBeenCalledWith({ type: "OPEN_REVIEW", captureId: "cap-1" }));
    expect(vi.mocked(deps.extractContainer).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deps.sendBackground).mock.invocationCallOrder[0]);
    expect(await controller.handleMessage({ type: "GET_CAPTURE_RESULT", captureId: "cap-1" })).toMatchObject({ adapterLabel: "Selected web content" });

    const cancelled = setup({ pickContainer: vi.fn(async () => { throw new Error(SELECTION_CANCELLED); }) });
    await cancelled.controller.handleMessage({ type: "START_CONTAINER_SELECTION" });
    await vi.waitFor(() => expect(cancelled.deps.pickContainer).toHaveBeenCalled());
    expect(cancelled.states).toEqual([]);
    expect(cancelled.deps.sendBackground).not.toHaveBeenCalled();
  });

  it("shows background failures in the pill", async () => {
    const { controller, last } = setup({ sendBackground: vi.fn(async () => ({ ok: false, error: "Tab create failed" })) });
    await controller.handleMessage({ type: "START_CAPTURE", action: "review" });
    await vi.waitFor(() => expect(last()).toEqual({ kind: "error", text: "Tab create failed" }));
  });
});

import { describe, expect, it, vi } from "vitest";
import { extractWithScrollCapture, mergeSnapshots } from "./scroll-capture";
import { ChatAdapter, ChatMessage, ConversationExport } from "../shared/types";
import { makeConversation } from "../testing/fixtures";

vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "0.0.0-test" }) } });

function msg(id: string, role: ChatMessage["role"] = "user", kind?: "activity"): ChatMessage {
  return {
    id,
    role,
    kind,
    content: [{ type: "text", text: `text ${id}` }],
    metadata: { providerMessageId: id }
  };
}

function plainMsg(role: ChatMessage["role"], text: string): ChatMessage {
  return { id: text, role, content: [{ type: "text", text }], metadata: { visibleTextHash: `hash:${text}` } };
}

function label(message: ChatMessage): string {
  const block = message.content[0];
  return `${message.role}:${block.type === "text" ? block.text : ""}`;
}

describe("mergeSnapshots", () => {
  it("updates known messages from later snapshots without reordering", () => {
    const first = msg("a", "assistant");
    const complete = { ...first, content: [{ type: "text" as const, text: "Complete reply" }] };
    const merged = mergeSnapshots([makeConversation([first, msg("b")]), makeConversation([complete, msg("b")])]);
    expect(merged.messages.map((message) => message.metadata.providerMessageId)).toEqual(["a", "b"]);
    expect(merged.messages[0].content).toEqual(complete.content);
  });

  it("assigns different review ids to equal texts with different provider ids", () => {
    const a = { ...msg("a"), id: "same-content-hash" };
    const b = { ...msg("b"), id: a.id, content: a.content };
    const merged = mergeSnapshots([makeConversation([a, b])]);
    const selected = new Set(merged.messages.map((message) => message.id));
    selected.delete(merged.messages[1].id);
    expect(merged.messages.filter((message) => selected.has(message.id))).toEqual([merged.messages[0]]);
  });
  it("orders messages by position even when the first snapshot already contains the tail", () => {
    // First snapshot after paging to the top: turns 1-2 plus still-mounted tail 46-50.
    const merged = mergeSnapshots([
      makeConversation([msg("1"), msg("2"), msg("46"), msg("47")]),
      makeConversation([msg("2"), msg("3"), msg("4")]),
      makeConversation([msg("4"), msg("5"), msg("46")]),
      makeConversation([msg("46"), msg("47")])
    ]);

    expect(merged.messages.map((m) => m.metadata.providerMessageId)).toEqual(["1", "2", "3", "4", "5", "46", "47"]);
    expect(merged.messages.map((m) => m.metadata.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("keeps repeated identical texts apart when provider ids differ, and activity apart from its message", () => {
    const a = msg("a");
    const b = { ...msg("b"), content: a.content };
    const merged = mergeSnapshots([makeConversation([msg("a", "assistant", "activity"), a, b])]);
    expect(merged.messages).toHaveLength(3);
  });

  it("falls back to role plus text hash without provider ids", () => {
    const plain = (text: string, hash: string): ChatMessage => ({
      id: text,
      role: "user",
      content: [{ type: "text", text }],
      metadata: { visibleTextHash: hash }
    });
    const merged = mergeSnapshots([
      makeConversation([plain("one", "h1"), plain("two", "h2")]),
      makeConversation([plain("two", "h2"), plain("three", "h3")])
    ]);
    expect(merged.messages.map((m) => m.content[0])).toEqual(["one", "two", "three"].map(text => ({ type: "text", text })));
  });

  it("keeps repeated texts without provider ids apart and in order within one snapshot", () => {
    const merged = mergeSnapshots([
      makeConversation([plainMsg("user", "continue"), plainMsg("assistant", "x"), plainMsg("user", "continue"), plainMsg("assistant", "y")])
    ]);
    expect(merged.messages.map(label)).toEqual(["user:continue", "assistant:x", "user:continue", "assistant:y"]);
  });

  it("lines up repeated texts without provider ids across overlapping snapshots", () => {
    const merged = mergeSnapshots([
      makeConversation([plainMsg("user", "continue"), plainMsg("assistant", "x"), plainMsg("user", "continue")]),
      makeConversation([plainMsg("assistant", "x"), plainMsg("user", "continue"), plainMsg("assistant", "y")]),
      makeConversation([plainMsg("user", "continue"), plainMsg("assistant", "y"), plainMsg("user", "continue"), plainMsg("assistant", "z")])
    ]);
    expect(merged.messages.map(label)).toEqual([
      "user:continue", "assistant:x", "user:continue", "assistant:y", "user:continue", "assistant:z"
    ]);
  });

  it("uses positions to keep fully repeating threads complete", () => {
    // 120 messages alternating two identical texts, 70 px each, seen through 20-message windows.
    const thread = Array.from({ length: 120 }, (_, i) => (i % 2 ? plainMsg("assistant", "same reply") : plainMsg("user", "continue")));
    const snapshots: ConversationExport[] = [];
    const tops: number[][] = [];
    for (let start = 0; start < 120; start += 8) {
      const window = thread.slice(start, start + 20).map((message) => ({ ...message }));
      snapshots.push(makeConversation(window));
      tops.push(window.map((_, i) => (start + i) * 70));
    }
    expect(mergeSnapshots(snapshots).messages.length).toBeLessThan(120);
    expect(mergeSnapshots(snapshots, tops).messages.map(label)).toEqual(thread.map(label));
  });

  it("matches positions after content above shifted the thread", () => {
    const thread = ["a", "continue", "b", "continue", "c", "continue", "d", "continue"].map((text) => plainMsg("user", text));
    const merged = mergeSnapshots(
      [makeConversation(thread.slice(0, 6)), makeConversation(thread.slice(2, 8))],
      // An image above loaded between the snapshots and pushed everything down by 300 px.
      [[0, 70, 140, 210, 280, 350], [440, 510, 580, 650, 720, 790]]
    );
    expect(merged.messages.map(label)).toEqual(thread.map(label));
  });
});

/**
 * Simulates a ChatGPT-style thread: 30 turns, paginated upwards in pages of 10,
 * and virtualised so only the turns near the viewport are mounted.
 */
function buildVirtualThread(total = 30, page = 10, turnHeight = 300, viewport = 800, virtualised = true) {
  document.body.innerHTML = `<div id="root"><div id="scroller"><main><div id="thread"></div></main></div></div>`;
  const scroller = document.getElementById("scroller") as HTMLElement;
  const thread = document.getElementById("thread") as HTMLElement;
  scroller.style.overflowY = "auto";

  let loadedFrom = total - page; // index of the oldest loaded turn
  let scrollTop = 0;
  const loadedCount = () => total - loadedFrom;
  const scrollHeight = () => loadedCount() * turnHeight;

  Object.defineProperty(scroller, "clientHeight", { get: () => viewport });
  Object.defineProperty(scroller, "scrollHeight", { get: scrollHeight });
  Object.defineProperty(scroller, "scrollTop", {
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = Math.max(0, Math.min(value, scrollHeight() - viewport));
      if (scrollTop === 0 && loadedFrom > 0) {
        // Async page load, then scroll anchoring keeps the previous first turn in place.
        setTimeout(() => {
          const added = Math.min(page, loadedFrom);
          loadedFrom -= added;
          scrollTop += added * turnHeight;
          render();
        }, 60);
      }
      render();
    }
  });

  function render() {
    const firstVisible = loadedFrom + Math.floor(scrollTop / turnHeight);
    const from = virtualised ? Math.max(loadedFrom, firstVisible - 2) : loadedFrom;
    const to = virtualised ? Math.min(total, firstVisible + Math.ceil(viewport / turnHeight) + 2) : total;
    thread.innerHTML = "";
    for (let i = from; i < to; i += 1) {
      const el = document.createElement("div");
      el.setAttribute("data-message-author-role", i % 2 === 0 ? "user" : "assistant");
      el.setAttribute("data-message-id", `m${i}`);
      el.textContent = `Turn ${i}`;
      thread.append(el);
    }
  }

  render();
  scrollTop = scrollHeight() - viewport;
  render();
  return { scroller, thread };
}

const fakeAdapter: ChatAdapter = {
  id: "generic",
  label: "Fake",
  capabilities: { modelName: false, timestamps: false, citations: false, artifacts: false, attachments: false },
  matches: () => true,
  async extract(document): Promise<ConversationExport> {
    const messages = [...document.querySelectorAll("[data-message-author-role]")].map((el, index) => ({
      id: el.getAttribute("data-message-id")!,
      role: el.getAttribute("data-message-author-role") as ChatMessage["role"],
      content: [{ type: "text" as const, text: el.textContent ?? "" }],
      metadata: { index, providerMessageId: el.getAttribute("data-message-id") ?? undefined }
    }));
    return makeConversation(messages);
  },
  messageElements(document) {
    return [...document.querySelectorAll("[data-message-author-role]")];
  }
};

describe("extractWithScrollCapture", () => {
  it("detects changed content when a virtualiser reuses its DOM nodes", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<div id="scroller" style="overflow-y:auto"><article data-message-author-role="assistant" data-message-id="m0">Turn 0</article></div>';
      const scroller = document.getElementById("scroller")!;
      const row = scroller.firstElementChild!;
      let top = 0;
      Object.defineProperties(scroller, {
        clientHeight: { get: () => 800 },
        scrollHeight: { get: () => 3000 },
        scrollTop: { get: () => top, set: (value: number) => {
          top = value;
          const index = Math.floor(value / 1000);
          row.setAttribute("data-message-id", `m${index}`);
          row.textContent = `Turn ${index}`;
        } }
      });
      const pending = extractWithScrollCapture(fakeAdapter, document);
      await vi.runAllTimersAsync();
      const conversation = await pending;
      expect(conversation.messages.map((message) => message.metadata.providerMessageId)).toEqual(["m0", "m1", "m2"]);
      expect(conversation.capture?.status).toBe("complete");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports the older-message loading limit and restores the scroll position on failure", async () => {
    vi.useFakeTimers();
    try {
      buildVirtualThread(1000, 10, 300);
      const pending = extractWithScrollCapture(fakeAdapter, document);
      await vi.runAllTimersAsync();
      const conversation = await pending;
      expect(conversation.capture?.reasons).toContain("load-limit");

      const { scroller: failingScroller } = buildVirtualThread(10, 10);
      const before = failingScroller.scrollTop;
      const failed = extractWithScrollCapture({ ...fakeAdapter, extract: async () => { throw new Error("Extraction failed"); } }, document);
      const rejection = expect(failed).rejects.toThrow("Extraction failed");
      await vi.runAllTimersAsync();
      await rejection;
      expect(failingScroller.scrollTop).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
  it("stops on abort, restores the scroll position and reports progress until then", async () => {
    vi.useFakeTimers();
    try {
      const { scroller } = buildVirtualThread(1000, 10, 300);
      const controller = new AbortController();
      const progress: string[] = [];
      const pending = extractWithScrollCapture(fakeAdapter, document, {
        signal: controller.signal,
        onProgress: (update) => progress.push(update.phase)
      });
      const rejection = expect(pending).rejects.toThrow("Capture cancelled.");
      await vi.advanceTimersByTimeAsync(3000);
      controller.abort(new Error("Capture cancelled."));
      await vi.runAllTimersAsync();
      await rejection;
      expect(progress[0]).toBe("loading");
      expect(progress).not.toContain("reading");
      // Started at the bottom, so it returns to the (now taller) bottom.
      expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it("reports reading progress with a running message count", async () => {
    vi.useFakeTimers();
    try {
      buildVirtualThread(30, 10);
      const counts: number[] = [];
      const pending = extractWithScrollCapture(fakeAdapter, document, {
        onProgress: (update) => { if (update.phase === "reading") counts.push(update.count); }
      });
      await vi.runAllTimersAsync();
      await pending;
      expect(counts.length).toBeGreaterThan(0);
      expect(counts).toEqual([...counts].sort((a, b) => a - b));
      expect(counts.at(-1)).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });
  it("sizes the walk to the thread, so tall threads complete", async () => {
    vi.useFakeTimers();
    try {
      // 300 tall turns need ~470 steps, beyond the old fixed limit of 200.
      buildVirtualThread(300, 300, 1000);
      const pending = extractWithScrollCapture(fakeAdapter, document);
      await vi.runAllTimersAsync();
      const conversation = await pending;
      expect(conversation.messages).toHaveLength(300);
      expect(conversation.capture).toEqual({ status: "complete", reasons: [] });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an incomplete walk when the page stops scrolling, without burning the whole budget", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<div id="scroller" style="overflow-y:auto"><article data-message-author-role="user" data-message-id="m0">Turn 0</article></div>';
      const scroller = document.getElementById("scroller")!;
      let top = 0;
      Object.defineProperties(scroller, {
        clientHeight: { get: () => 800 },
        scrollHeight: { get: () => 10000 },
        // The page pins the view at 2000px.
        scrollTop: { get: () => top, set: (value: number) => { top = Math.min(value, 2000); } }
      });
      const pending = extractWithScrollCapture({ ...fakeAdapter, scroll: { loadsOlderOnTop: false, virtualised: true } }, document);
      const started = Date.now();
      await vi.runAllTimersAsync();
      const conversation = await pending;
      expect(conversation.capture).toEqual({ status: "incomplete", reasons: ["walk-limit"] });
      // ~4 steps to reach 2000px plus 3 stuck steps, at ~250ms each, instead of ~45 budgeted steps.
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("detects a reused element whose text changes without any id attribute", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = '<div id="scroller" style="overflow-y:auto"><article data-message-author-role="assistant">Turn 0</article></div>';
      const scroller = document.getElementById("scroller")!;
      const row = scroller.firstElementChild!;
      let top = 0;
      Object.defineProperties(scroller, {
        clientHeight: { get: () => 800 },
        scrollHeight: { get: () => 3000 },
        scrollTop: { get: () => top, set: (value: number) => {
          top = value;
          // Same length, same element, no ids: only the text tells the messages apart.
          row.textContent = `Turn ${Math.floor(value / 1000)}`;
        } }
      });
      const pending = extractWithScrollCapture(fakeAdapter, document);
      await vi.runAllTimersAsync();
      const conversation = await pending;
      expect(conversation.messages.map((message) => message.content[0])).toEqual(
        ["Turn 0", "Turn 1", "Turn 2"].map((text) => ({ type: "text", text }))
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips loading older turns when the adapter does not paginate", async () => {
    vi.useFakeTimers();
    try {
      // The fake would page in older turns at the top; a non-paginating adapter must not wait for that.
      buildVirtualThread(30, 10);
      const progress: string[] = [];
      const pending = extractWithScrollCapture(
        { ...fakeAdapter, scroll: { loadsOlderOnTop: false, virtualised: true } },
        document,
        { onProgress: (update) => progress.push(update.phase) }
      );
      await vi.runAllTimersAsync();
      const conversation = await pending;
      expect(progress).not.toContain("loading");
      expect(conversation.capture?.status).toBe("complete");
    } finally {
      vi.useRealTimers();
    }
  });

  it("is quicker on a short chat when the adapter does not paginate", async () => {
    vi.useFakeTimers();
    try {
      const elapsed = async (adapter: ChatAdapter) => {
        buildVirtualThread(2, 2, 300);
        const started = Date.now();
        const pending = extractWithScrollCapture(adapter, document);
        await vi.runAllTimersAsync();
        await pending;
        return Date.now() - started;
      };
      const unknown = await elapsed(fakeAdapter);
      const claudeLike = await elapsed({ ...fakeAdapter, scroll: { loadsOlderOnTop: false, virtualised: true } });
      // The load phase alone costs at least LOAD_MIN_WAIT_MS + LOAD_CONFIRM_WAIT_MS.
      expect(unknown - claudeLike).toBeGreaterThanOrEqual(1900);
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads older turns then extracts once when the thread is not virtualised", async () => {
    vi.useFakeTimers();
    try {
      const { scroller } = buildVirtualThread(30, 10, 300, 800, false);
      const extractSpy = vi.spyOn(fakeAdapter, "extract");
      const counts: number[] = [];
      const pending = extractWithScrollCapture(
        { ...fakeAdapter, scroll: { loadsOlderOnTop: true, virtualised: false } },
        document,
        { onProgress: (update) => { if (update.phase === "reading") counts.push(update.count); } }
      );
      await vi.runAllTimersAsync();
      const conversation = await pending;
      expect(conversation.messages.map((m) => m.metadata.providerMessageId)).toEqual(Array.from({ length: 30 }, (_, i) => `m${i}`));
      expect(conversation.capture?.status).toBe("complete");
      expect(extractSpy).toHaveBeenCalledTimes(1);
      expect(counts).toEqual([30]);
      expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight);
      extractSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
  it("pages to the top and walks a virtualised thread, capturing every turn in order", async () => {
    const { scroller } = buildVirtualThread();
    const extractSpy = vi.spyOn(fakeAdapter, "extract");

    const conversation = await extractWithScrollCapture(fakeAdapter, document);

    expect(conversation.messages.map((m) => m.metadata.providerMessageId)).toEqual(
      Array.from({ length: 30 }, (_, i) => `m${i}`)
    );
    // Started at the bottom, so it ends at the (now taller) bottom.
    expect(scroller.scrollTop).toBe(scroller.scrollHeight - scroller.clientHeight);
    // Extraction only runs when the rendered set changes, not on every scroll step.
    expect(extractSpy.mock.calls.length).toBeLessThan(40);
    extractSpy.mockRestore();
  }, 20000);
});

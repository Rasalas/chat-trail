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
});

/**
 * Simulates a ChatGPT-style thread: 30 turns, paginated upwards in pages of 10,
 * and virtualised so only the turns near the viewport are mounted.
 */
function buildVirtualThread(total = 30, page = 10, turnHeight = 300, viewport = 800) {
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
    const from = Math.max(loadedFrom, firstVisible - 2);
    const to = Math.min(total, firstVisible + Math.ceil(viewport / turnHeight) + 2);
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
  it("reports an incomplete capture when the walk limit is reached", async () => {
    vi.useFakeTimers();
    try {
      buildVirtualThread(300, 300, 1000);
      const pending = extractWithScrollCapture(fakeAdapter, document);
      await vi.runAllTimersAsync();
      const conversation = await pending;
      expect(conversation.messages.length).toBeLessThan(300);
      expect(conversation.capture).toEqual({ status: "incomplete", reasons: ["walk-limit"] });
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

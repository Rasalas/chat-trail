import { describe, expect, it, vi } from "vitest";
import { extractWithScrollCapture, mergeSnapshots } from "./scroll-capture";
import { ChatAdapter, ChatMessage, ConversationExport } from "../shared/types";
import { makeConversation } from "../testing/fixtures";

vi.stubGlobal("chrome", { runtime: { getManifest: () => ({ version: "0.0.0-test" }) } });

function msg(id: string, role: ChatMessage["role"] = "user", kind?: "activity"): ChatMessage {
  return {
    id,
    role,
    content: [{ type: "text", text: `text ${id}` }],
    metadata: { providerMessageId: id, kind }
  };
}

describe("mergeSnapshots", () => {
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
    expect(merged.messages.map((m) => m.id)).toEqual(["one", "two", "three"]);
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

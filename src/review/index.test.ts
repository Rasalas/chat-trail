// @vitest-environment jsdom
import { Blob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeConversation, makeMessage } from "../testing/fixtures";
import { ContentRequest } from "../shared/types";

const download = vi.hoisted(() => vi.fn());
vi.mock("../shared/download", () => ({
  downloadBlob: download,
  blobFromText: (text: string, type: string) => new Blob([text], { type })
}));

const html = readFileSync("src/review/index.html", "utf8");
const source = makeConversation([
  makeMessage("user", 0, [{ type: "text", text: "person@example.com" }]),
  makeMessage("assistant", 1, [{ type: "text", text: "Same reply" }]),
  makeMessage("assistant", 2, [{ type: "text", text: "Same reply" }])
]);
source.source.url = "https://example.com/chat/a";

async function startReview() {
  const { openReviewSession } = await import("../shared/review-session");
  const sessionId = await openReviewSession(42);
  window.history.replaceState(null, "", `/?session=${sessionId}`);
  await import("./index");
  await vi.waitFor(() => expect(document.querySelectorAll(".message-row")).toHaveLength(3));
  return { openReviewSession };
}

function click(selector: string) {
  document.querySelector<HTMLButtonElement>(selector)!.click();
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("Blob", Blob);
  vi.stubGlobal("crypto", webcrypto);
  document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1];
  const stored: Record<string, unknown> = {};
  const tabs = new Map<number, { id: number; windowId: number; url: string }>([
    [42, { id: 42, windowId: 1, url: source.source.url }],
    [43, { id: 43, windowId: 1, url: "https://example.com/chat/b" }]
  ]);
  let activeId = 42;
  let nextId = 100;
  vi.stubGlobal("chrome", {
    runtime: { getURL: (path: string) => `chrome-extension://test/${path}`, getManifest: () => ({ version: "test" }) },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: structuredClone(stored[key]) })),
        set: vi.fn(async (value: object) => { Object.assign(stored, structuredClone(value)); }),
        remove: vi.fn(async (keys: string | string[]) => { for (const key of [keys].flat()) delete stored[key]; })
      },
      sync: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }
    },
    tabs: {
      create: vi.fn(async ({ url }: { url: string }) => {
        const tab = { id: nextId++, windowId: 1, url };
        tabs.set(tab.id, tab);
        activeId = tab.id;
        return tab;
      }),
      get: vi.fn(async (id: number) => tabs.get(id)),
      query: vi.fn(async () => [tabs.get(activeId)]),
      update: vi.fn(async (id: number) => { activeId = id; return tabs.get(id); }),
      sendMessage: vi.fn(async (_id: number, request: ContentRequest) => request.type === "GET_HTML_SNAPSHOT"
        ? { ok: true, html: "<p>original-person@example.com</p>" }
        : { ok: true, conversation: structuredClone(source), adapterId: "generic", adapterLabel: "Test" }),
      captureVisibleTab: vi.fn(async () => "data:image/png;base64,c2NyZWVuc2hvdA==")
    },
    windows: { update: vi.fn(async () => undefined) }
  });
});

describe("review workflow", () => {
  it("refreshes and captures from its own source after another review opens", async () => {
    const { openReviewSession } = await startReview();
    await openReviewSession(43);
    click("#refresh");
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(2));
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(42, { type: "EXTRACT_CONVERSATION", useProviderCopy: false });
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>("#refresh")!.disabled).toBe(false));
    document.querySelector<HTMLInputElement>("#include-original-page")!.checked = true;
    click('[data-export="zip"]');
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(42, { type: "GET_HTML_SNAPSHOT", expectedUrl: source.source.url });
    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledOnce();
    expect(document.querySelector<HTMLInputElement>("#include-original-page")!.checked).toBe(false);
  });

  it("exports the reviewed selection without requesting original page evidence", async () => {
    await startReview();
    document.querySelectorAll<HTMLButtonElement>(".message-remove")[1].click();
    expect(document.querySelectorAll(".message-row")).toHaveLength(2);
    click('[data-export="zip"]');
    await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
    const zip = new TextDecoder().decode(await download.mock.calls[0][0].arrayBuffer());
    expect(zip).toContain("[redacted-email]");
    expect(zip).not.toContain("person@example.com");
    expect(zip).not.toContain("snapshot.html");
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("edits only the selected occurrence of a repeated reply", async () => {
    await startReview();
    document.querySelectorAll<HTMLButtonElement>(".message-edit")[2].click();
    document.querySelector<HTMLTextAreaElement>("textarea")!.value = "Changed second reply";
    click(".editor-buttons .primary");
    const messages = [...document.querySelectorAll(".message-body")].map(node => node.textContent);
    expect(messages).toEqual(["[redacted-email]", "Same reply", "Changed second reply"]);
  });

  it("rejects original evidence after the source page navigates", async () => {
    await startReview();
    vi.mocked(chrome.tabs.get).mockResolvedValue({ id: 42, windowId: 1, url: "https://example.com/chat/other" } as chrome.tabs.Tab);
    document.querySelector<HTMLInputElement>("#include-original-page")!.checked = true;
    click('[data-export="zip"]');
    await vi.waitFor(() => expect(document.querySelector("#summary")!.textContent).toContain("source page has changed"));
    expect(download).not.toHaveBeenCalled();
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });
});

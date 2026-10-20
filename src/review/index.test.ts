// @vitest-environment jsdom
import { Blob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeConversation, makeMessage } from "../testing/fixtures";
import { ContentRequest } from "../shared/types";
import { SOURCE_CLOSED, SOURCE_RELOADED } from "./source-capture";

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
  const sessionId = await openReviewSession(42, "cap-initial");
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
      getCurrent: vi.fn(async () => tabs.get(100)),
      sendMessage: vi.fn(async (_id: number, request: ContentRequest) => {
        if (request.type === "GET_HTML_SNAPSHOT") return { ok: true, html: "<p>original-person@example.com</p>" };
        if (request.type === "RUN_CAPTURE") return { ok: true, captureId: "cap-refreshed" };
        return { ok: true, conversation: structuredClone(source), adapterId: "generic", adapterLabel: "Test" };
      }),
      captureVisibleTab: vi.fn(async () => "data:image/png;base64,c2NyZWVuc2hvdA==")
    },
    windows: { update: vi.fn(async () => undefined) }
  });
});

describe("review workflow", () => {
  it("refreshes and captures from its own source after another review opens", async () => {
    const { openReviewSession } = await startReview();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { type: "GET_CAPTURE_RESULT", captureId: "cap-initial" });
    await openReviewSession(43, "cap-other");
    vi.mocked(chrome.tabs.update).mockClear();
    click("#refresh");
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(3));
    expect(chrome.tabs.sendMessage).toHaveBeenNthCalledWith(2, 42, { type: "RUN_CAPTURE", useProviderCopy: false });
    expect(chrome.tabs.sendMessage).toHaveBeenLastCalledWith(42, { type: "GET_CAPTURE_RESULT", captureId: "cap-refreshed" });
    // The source tab is brought to the front for the capture, then the review tab returns.
    expect(vi.mocked(chrome.tabs.update).mock.calls.map(([id]) => id)).toEqual([42, 100]);
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
    expect(document.querySelectorAll(".message-row.included")).toHaveLength(2);
    expect(document.querySelectorAll(".message-row.removed .message-restore")).toHaveLength(1);
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
    await vi.waitFor(() => expect(document.querySelector("#error-line")!.textContent).toContain("source page has changed"));
    expect(download).not.toHaveBeenCalled();
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });

  it("explains a closed source tab instead of showing the raw tab error", async () => {
    await startReview();
    vi.mocked(chrome.tabs.get).mockRejectedValue(new Error("No tab with id: 42."));
    click("#refresh");
    await vi.waitFor(() => expect(document.querySelector("#error-line")!.textContent).toBe(SOURCE_CLOSED));
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".message-row")).toHaveLength(3);
  });

  it("explains that a reloaded source tab no longer holds the capture", async () => {
    const { openReviewSession } = await import("../shared/review-session");
    const sessionId = await openReviewSession(42, "cap-initial");
    window.history.replaceState(null, "", `/?session=${sessionId}`);
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValue(new Error("Could not establish connection. Receiving end does not exist."));
    await import("./index");
    await vi.waitFor(() => expect(document.querySelector("#error-line")!.textContent).toBe(SOURCE_RELOADED));
  });

  it("keeps the current review and returns to it when the capture is cancelled", async () => {
    await startReview();
    vi.mocked(chrome.tabs.sendMessage).mockResolvedValueOnce({ ok: false, error: "Capture cancelled." });
    vi.mocked(chrome.tabs.update).mockClear();
    click("#refresh");
    await vi.waitFor(() => expect(document.querySelector("#error-line")!.textContent).toBe("Capture cancelled."));
    expect(vi.mocked(chrome.tabs.update).mock.calls.at(-1)?.[0]).toBe(100);
    expect(document.querySelectorAll(".message-row")).toHaveLength(3);
  });
});

describe("review interactions", () => {
  it("restores a single excluded message and keeps the other rows", async () => {
    await startReview();
    const firstRow = document.querySelector(".message-row");
    document.querySelectorAll<HTMLButtonElement>(".message-remove")[1].click();
    expect(document.querySelector("#summary")!.textContent).toMatch(/^2 of 3 messages/);
    expect(document.querySelector(".message-row")).toBe(firstRow);
    click(".message-restore");
    expect(document.querySelectorAll(".message-row.included")).toHaveLength(3);
    expect(document.querySelector(".message-row")).toBe(firstRow);
  });

  it("asks before a refresh discards exclusions", async () => {
    await startReview();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    click("#refresh");
    expect(confirm).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>("#refresh")!.disabled).toBe(false));

    document.querySelectorAll<HTMLButtonElement>(".message-remove")[0].click();
    click("#refresh");
    expect(confirm).toHaveBeenCalledOnce();
    expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(3);

    confirm.mockReturnValue(true);
    click("#refresh");
    await vi.waitFor(() => expect(chrome.tabs.sendMessage).toHaveBeenCalledTimes(5));
    confirm.mockRestore();
  });

  it("redacts block by block, keeps code blocks and can undo", async () => {
    const withCode = makeConversation([
      makeMessage("user", 0, [{ type: "text", text: "Fix my config" }]),
      makeMessage("assistant", 1, [
        { type: "text", text: "Mail person@example.com" },
        { type: "code", language: "ini", text: "api_key = abcd1234efgh5678" }
      ])
    ]);
    vi.mocked(chrome.tabs.sendMessage).mockImplementation(async () => ({ ok: true, conversation: structuredClone(withCode), adapterId: "generic", adapterLabel: "Test" }));
    const { openReviewSession } = await import("../shared/review-session");
    window.history.replaceState(null, "", `/?session=${await openReviewSession(42, "cap-initial")}`);
    await import("./index");
    await vi.waitFor(() => expect(document.querySelectorAll(".message-row")).toHaveLength(2));
    const redactOption = document.querySelector<HTMLInputElement>('[data-option="redactSecrets"]')!;
    redactOption.checked = false;
    redactOption.dispatchEvent(new Event("change"));
    expect(document.querySelector("pre")!.textContent).toContain("abcd1234efgh5678");

    click("#redact-now");
    expect(document.querySelector("pre")!.textContent).toBe("api_key=[redacted-secret]");
    expect(document.querySelector(".message-row.assistant")!.textContent).toContain("[redacted-email]");

    click(".toast-action");
    expect(document.querySelector("pre")!.textContent).toBe("api_key = abcd1234efgh5678");
  });

  it("closes popovers on Escape, keeps only one open and titles the tab", async () => {
    await startReview();
    expect(document.title).toBe("Test Chat – Chat Trail");
    const settings = document.querySelector<HTMLDetailsElement>("#settings-popover")!;
    const exportMenu = document.querySelector<HTMLDetailsElement>("#export-popover")!;
    settings.open = true;
    settings.dispatchEvent(new Event("toggle"));
    exportMenu.open = true;
    exportMenu.dispatchEvent(new Event("toggle"));
    expect(settings.open).toBe(false);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(exportMenu.open).toBe(false);
    expect(document.activeElement).toBe(exportMenu.querySelector("summary"));
  });

  it("prints through a hidden iframe instead of a blob window", async () => {
    await startReview();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    click('[data-export="print"]');
    await vi.waitFor(() => expect(document.querySelector("iframe")?.getAttribute("srcdoc")).toContain("Test Chat"));
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });
});

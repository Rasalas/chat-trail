// @vitest-environment jsdom
import { Blob } from "node:buffer";
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createEvidencePack } from "./evidence";
import { applyExportOptions } from "./filter";
import { makeConversation, makeMessage } from "../testing/fixtures";
import { DEFAULT_EXPORT_OPTIONS } from "../shared/types";

vi.stubGlobal("Blob", Blob);
vi.stubGlobal("crypto", webcrypto);

describe("createEvidencePack", () => {
  it("includes original evidence only with opt-in and marks it as unredacted", async () => {
    const pack = await createEvidencePack({
      conversation: makeConversation([]),
      includeOriginalPage: true,
      htmlSnapshot: '<p>Original text</p><img src="x" onerror="alert(1)">',
      screenshotDataUrl: "data:image/png;base64,c2NyZWVuc2hvdA=="
    });
    const zipText = new TextDecoder().decode(await pack.arrayBuffer());
    expect(zipText).toContain("snapshot.html");
    expect(zipText).toContain("visible-screenshot.png");
    expect(zipText).toContain("Original text");
    expect(zipText).toContain('"original_page_included": true');
    expect(zipText).toContain("unredacted");
    expect(zipText).not.toContain("onerror");
  });

  it("records capture limits in every transcript and the manifest", async () => {
    const conversation = makeConversation([]);
    conversation.capture = { status: "incomplete", reasons: ["walk-limit"] };
    const pack = await createEvidencePack({ conversation });
    const bytes = new Uint8Array(await pack.arrayBuffer());
    const files = new Map<string, string>();
    const view = new DataView(bytes.buffer);
    let offset = 0;
    while (view.getUint32(offset, true) === 0x04034b50) {
      const size = view.getUint32(offset + 18, true);
      const nameLength = view.getUint16(offset + 26, true);
      const extraLength = view.getUint16(offset + 28, true);
      const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
      const start = offset + 30 + nameLength + extraLength;
      files.set(name, new TextDecoder().decode(bytes.subarray(start, start + size)));
      offset = start + size;
    }
    expect(files.get("transcript.md")).toContain("Incomplete capture:");
    expect(files.get("transcript.html")).toContain("Incomplete capture:");
    for (const name of ["conversation.json", "manifest.json"]) {
      expect(JSON.parse(files.get(name)!).capture).toEqual(conversation.capture);
    }
  });
  it("does not include original page evidence without an explicit opt-in", async () => {
    const conversation = makeConversation([makeMessage("user", 0, [{ type: "text", text: "person@example.com" }])]);
    const pack = await createEvidencePack({
      conversation: applyExportOptions(conversation, DEFAULT_EXPORT_OPTIONS),
      htmlSnapshot: "<p>person@example.com</p>",
      screenshotDataUrl: "data:image/png;base64,c2VjcmV0LXNjcmVlbnNob3Q="
    });
    const zipText = new TextDecoder().decode(await pack.arrayBuffer());
    expect(zipText).toContain("[redacted-email]");
    expect(zipText).not.toContain("person@example.com");
    expect(zipText).not.toContain("secret-screenshot");
    expect(zipText).not.toContain("snapshot.html");
    expect(zipText).not.toContain("visible-screenshot.png");
  });
});

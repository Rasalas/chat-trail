import { ConversationExport } from "../shared/types";
import { exportHtml } from "./html";
import { exportJson } from "./json";
import { exportMarkdown } from "./markdown";
import { createZip, ZipInput } from "./zip";
import { sha256Hex } from "../shared/hash";

export interface EvidenceInputs {
  conversation: ConversationExport;
  htmlSnapshot?: string;
  screenshotDataUrl?: string;
  browser?: string;
  platform?: string;
}

export async function createEvidencePack(input: EvidenceInputs): Promise<Blob> {
  const markdown = exportMarkdown(input.conversation);
  const json = exportJson(input.conversation);
  const html = exportHtml(input.conversation);
  const files: ZipInput[] = [
    { name: "transcript.md", data: markdown },
    { name: "conversation.json", data: json },
    { name: "transcript.html", data: html }
  ];

  const hashes: Record<string, string> = {
    "transcript.md": await sha256Hex(markdown),
    "conversation.json": await sha256Hex(json),
    "transcript.html": await sha256Hex(html)
  };

  if (input.htmlSnapshot) {
    files.push({ name: "snapshot.html", data: input.htmlSnapshot });
    hashes["snapshot.html"] = await sha256Hex(input.htmlSnapshot);
  }

  if (input.screenshotDataUrl) {
    const bytes = dataUrlToBytes(input.screenshotDataUrl);
    files.push({ name: "visible-screenshot.png", data: bytes });
    hashes["visible-screenshot.png"] = await sha256Hex(bytes);
  }

  const manifest = {
    schema_version: input.conversation.schema_version,
    source: input.conversation.source,
    extension_version: input.conversation.manifest.extension_version,
    browser: input.browser,
    platform: input.platform,
    generated_at: new Date().toISOString(),
    exported_formats: files.map((file) => file.name),
    hashes
  };

  files.push({ name: "manifest.json", data: JSON.stringify(manifest, null, 2) });
  return createZip(files);
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

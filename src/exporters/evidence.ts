import { ContentBlock, ConversationExport } from "../shared/types";
import { exportHtml } from "./html";
import { exportJson } from "./json";
import { exportMarkdown } from "./markdown";
import { createZip, ZipInput } from "./zip";
import { sha256Hex } from "../shared/hash";
import { sanitizeContentHtml } from "../shared/sanitize";

export interface EvidenceInputs {
  conversation: ConversationExport;
  htmlSnapshot?: string;
  screenshotDataUrl?: string;
  includeOriginalPage?: boolean;
  browser?: string;
  platform?: string;
}

export async function createEvidencePack(input: EvidenceInputs): Promise<Blob> {
  const files: ZipInput[] = [];
  const hashes: Record<string, string> = {};
  const conversation = await materializeImageArtifacts(input.conversation, files, hashes);
  const markdown = exportMarkdown(conversation);
  const json = exportJson(conversation);
  const html = exportHtml(conversation);
  files.unshift(
    { name: "transcript.md", data: markdown },
    { name: "conversation.json", data: json },
    { name: "transcript.html", data: html }
  );

  hashes["transcript.md"] = await sha256Hex(markdown);
  hashes["conversation.json"] = await sha256Hex(json);
  hashes["transcript.html"] = await sha256Hex(html);

  if (input.includeOriginalPage && input.htmlSnapshot) {
    const snapshot = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; base-uri 'none'; form-action 'none'"></head><body>${sanitizeContentHtml(input.htmlSnapshot)}</body></html>`;
    files.push({ name: "snapshot.html", data: snapshot });
    hashes["snapshot.html"] = await sha256Hex(snapshot);
  }

  if (input.includeOriginalPage && input.screenshotDataUrl) {
    const bytes = dataUrlToBytes(input.screenshotDataUrl);
    files.push({ name: "visible-screenshot.png", data: bytes });
    hashes["visible-screenshot.png"] = await sha256Hex(bytes);
  }

  const manifest = {
    schema_version: conversation.schema_version,
    capture: conversation.capture,
    original_page_included: Boolean(input.includeOriginalPage && (input.htmlSnapshot || input.screenshotDataUrl)),
    original_page_warning: input.includeOriginalPage ? "Original page evidence is unredacted and is not affected by transcript selection or edits." : undefined,
    source: conversation.source,
    extension_version: conversation.manifest.extension_version,
    artifacts: conversation.artifacts,
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

async function materializeImageArtifacts(
  input: ConversationExport,
  files: ZipInput[],
  hashes: Record<string, string>
): Promise<ConversationExport> {
  const conversation = structuredClone(input);

  for (const [messageIndex, message] of conversation.messages.entries()) {
    for (const [blockIndex, block] of message.content.entries()) {
      if (block.type !== "image" || !block.data_url) continue;

      const bytes = dataUrlToBytes(block.data_url);
      const extension = extensionForMime(block.mime_type) ?? extensionFromFilename(block.filename) ?? "png";
      const filename = `artifacts/images/message-${messageIndex + 1}-image-${blockIndex + 1}.${extension}`;
      const hash = await sha256Hex(bytes);

      files.push({ name: filename, data: bytes });
      hashes[filename] = hash;
      conversation.artifacts.push({
        id: `image-${messageIndex + 1}-${blockIndex + 1}`,
        type: "image",
        filename,
        mime_type: block.mime_type ?? "image/png",
        bytes: bytes.byteLength,
        sha256: hash
      });

      message.content[blockIndex] = {
        ...withoutDataUrl(block),
        src: filename,
        filename: block.filename ?? filename.split("/").at(-1)
      };
    }
  }

  return conversation;
}

function withoutDataUrl(block: Extract<ContentBlock, { type: "image" }>): Extract<ContentBlock, { type: "image" }> {
  const { data_url: _dataUrl, ...rest } = block;
  return rest;
}

function extensionForMime(mimeType: string | undefined): string | undefined {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  return undefined;
}

function extensionFromFilename(filename: string | undefined): string | undefined {
  const extension = filename?.split(".").at(-1)?.toLowerCase();
  return extension && /^[a-z0-9]{2,5}$/.test(extension) ? extension : undefined;
}

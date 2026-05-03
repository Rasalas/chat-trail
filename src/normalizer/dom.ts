import { ChatMessage, ContentBlock, ConversationExport, ProviderId } from "../shared/types";
import { compactWhitespace } from "../shared/strings";
import { sha256Hex, stableId } from "../shared/hash";

export function createBaseConversation(provider: ProviderId, document: Document): ConversationExport {
  return {
    schema_version: "1.0",
    source: {
      provider,
      url: document.location.href,
      title: document.title || provider,
      captured_at: new Date().toISOString()
    },
    messages: [],
    artifacts: [],
    manifest: {
      extension_version: chrome.runtime.getManifest().version,
      hashes: {}
    }
  };
}

export async function elementToMessage(
  element: Element,
  role: ChatMessage["role"],
  index: number,
  selector?: string
): Promise<ChatMessage | null> {
  const content = await extractContentBlocks(element);
  const visibleText = contentToPlainText(content);

  if (!visibleText && content.length === 0) {
    return null;
  }

  return {
    id: stableId(role, index, visibleText || element.outerHTML.slice(0, 512)),
    role,
    content,
    metadata: {
      index,
      selector,
      timestamp: extractTime(element),
      visibleTextHash: await sha256Hex(visibleText)
    }
  };
}

export async function extractContentBlocks(root: Element): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  await collectBlocksInOrder(root, blocks);

  return mergeAdjacentText(blocks.filter((block) => {
    if (block.type === "text") return block.text.length > 0;
    if (block.type === "code") return block.text.length > 0;
    if (block.type === "table") return block.markdown.length > 0;
    if (block.type === "quote") return block.text.length > 0;
    if (block.type === "link") return block.url.length > 0;
    return block.src || block.alt;
  }));
}

export function contentToPlainText(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text" || block.type === "code" || block.type === "quote") return block.text;
      if (block.type === "table") return block.markdown;
      if (block.type === "link") return `${block.text} ${block.url}`;
      return [block.alt, block.filename, block.src].filter(Boolean).join(" ");
    })
    .join("\n\n")
    .trim();
}

export function inferRole(element: Element, index: number): ChatMessage["role"] {
  const marker = compactWhitespace(
    [
      element.getAttribute("data-message-author-role"),
      element.getAttribute("data-testid"),
      element.getAttribute("aria-label"),
      element.className?.toString(),
      element.textContent?.slice(0, 80)
    ]
      .filter(Boolean)
      .join(" ")
  ).toLowerCase();

  if (/\b(user|human|you|ich|me)\b/.test(marker)) return "user";
  if (/\b(assistant|claude|chatgpt|bot|ai)\b/.test(marker)) return "assistant";
  return index % 2 === 0 ? "user" : "assistant";
}

export function uniqueElements(selectors: string[], root: ParentNode = document): Element[] {
  const seen = new Set<Element>();
  const elements: Element[] = [];

  try {
    root.querySelectorAll(selectors.join(", ")).forEach((element) => {
      if (!seen.has(element) && compactWhitespace(element.textContent ?? "").length > 0) {
        seen.add(element);
        elements.push(element);
      }
    });
    return elements;
  } catch {
    // Keep extraction working if a browser rejects one provider-specific selector.
  }

  for (const selector of selectors) {
    root.querySelectorAll(selector).forEach((element) => {
      if (!seen.has(element) && compactWhitespace(element.textContent ?? "").length > 0) {
        seen.add(element);
        elements.push(element);
      }
    });
  }

  elements.sort((a, b) => {
    if (a === b) return 0;
    const position = a.compareDocumentPosition(b);
    return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });

  return elements;
}

function tableToMarkdown(table: HTMLTableElement): string {
  const rows = [...table.querySelectorAll("tr")]
    .map((row) => [...row.children].map((cell) => compactWhitespace(cell.textContent ?? "")))
    .filter((cells) => cells.some(Boolean));

  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array<string>(width - row.length).fill("")]);
  const header = normalized[0];
  const separator = Array<string>(width).fill("---");
  return [header, separator, ...normalized.slice(1)]
    .map((row) => `| ${row.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`)
    .join("\n");
}

async function collectBlocksInOrder(root: Element, blocks: ContentBlock[]): Promise<void> {
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = compactWhitespace(child.textContent ?? "");
      if (text) blocks.push({ type: "text", text });
      continue;
    }

    if (!(child instanceof Element)) continue;
    if (child.matches("script, style, noscript, button, svg, [aria-hidden='true']")) continue;

    if (child.matches("pre")) {
      const code = child.querySelector("code");
      const languageClass = [...(code?.classList ?? [])].find((name) => name.startsWith("language-"));
      const text = (code ?? child).textContent?.trim() ?? "";
      if (text) {
        blocks.push({ type: "code", language: languageClass?.replace("language-", ""), text });
      }
      continue;
    }

    if (child.matches("table")) {
      const markdown = tableToMarkdown(child as HTMLTableElement);
      if (markdown) blocks.push({ type: "table", markdown });
      continue;
    }

    if (child.matches("blockquote")) {
      const text = inlineMarkdown(child).trim();
      if (text) blocks.push({ type: "quote", text });
      continue;
    }

    if (child.matches("img")) {
      const img = child as HTMLImageElement;
      const src = img.currentSrc || img.src;
      const alt = img.alt || img.title;
      const data_url = await imageToDataUrl(img);
      if (src || alt || data_url) {
        blocks.push({
          type: "image",
          src,
          alt,
          filename: filenameFromUrl(src),
          data_url,
          mime_type: data_url ? mimeTypeFromDataUrl(data_url) : undefined
        });
      }
      continue;
    }

    if (isProseBlock(child) && !hasBlockChildren(child)) {
      const text = formatProseBlock(child);
      if (text) blocks.push({ type: "text", text });
      continue;
    }

    await collectBlocksInOrder(child, blocks);
  }
}

function formatProseBlock(element: Element): string {
  const text = inlineMarkdown(element).trim();
  if (!text) return "";

  if (/^H[1-6]$/.test(element.tagName)) {
    const depth = Number(element.tagName.slice(1));
    return `${"#".repeat(Math.min(depth + 2, 6))} ${text}`;
  }

  if (element.tagName === "LI") return `- ${text}`;
  return text;
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (node.matches("script, style, noscript, button, svg, [aria-hidden='true']")) return "";

  if (node.matches("br")) return "\n";
  if (node.matches("code") && !node.closest("pre")) return `\`${compactWhitespace(node.textContent ?? "")}\``;
  if (node.matches("strong, b")) return `**${compactWhitespace(childrenInlineMarkdown(node))}**`;
  if (node.matches("em, i")) return `_${compactWhitespace(childrenInlineMarkdown(node))}_`;
  if (node.matches("a[href]")) {
    const anchor = node as HTMLAnchorElement;
    const text = compactWhitespace(childrenInlineMarkdown(anchor) || anchor.href);
    if (!anchor.href || anchor.href.startsWith("javascript:")) return text;
    return `[${text}](${anchor.href})`;
  }
  if (node.matches("img")) {
    const image = node as HTMLImageElement;
    const src = image.currentSrc || image.src;
    const alt = image.alt || image.title || filenameFromUrl(src) || "image";
    return src ? `![${alt}](${src})` : alt;
  }

  return childrenInlineMarkdown(node);
}

function childrenInlineMarkdown(element: Element): string {
  return [...element.childNodes]
    .map((child) => inlineMarkdown(child))
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}

function isProseBlock(element: Element): boolean {
  return /^(P|LI|H[1-6]|DD|DT|FIGCAPTION|SUMMARY)$/.test(element.tagName) || !hasBlockChildren(element);
}

function hasBlockChildren(element: Element): boolean {
  return Boolean(
    element.querySelector(
      "article, section, div, p, ul, ol, li, pre, table, blockquote, h1, h2, h3, h4, h5, h6, figure"
    )
  );
}

function extractTime(element: Element): string | undefined {
  const time = element.querySelector("time");
  return time?.getAttribute("datetime") ?? time?.textContent?.trim() ?? undefined;
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split("/").filter(Boolean).at(-1);
  } catch {
    return undefined;
  }
}

async function imageToDataUrl(image: HTMLImageElement): Promise<string | undefined> {
  const src = image.currentSrc || image.src;
  if (!src) return undefined;
  if (src.startsWith("data:image/")) return src;

  if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
    await waitForImage(image);
  }

  if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) return undefined;

  try {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) return undefined;
    context.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

function waitForImage(image: HTMLImageElement): Promise<void> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(resolve, 800);
    image.addEventListener(
      "load",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
    image.addEventListener(
      "error",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

function mimeTypeFromDataUrl(dataUrl: string): string | undefined {
  return dataUrl.match(/^data:([^;]+);base64,/)?.[1];
}

function mergeAdjacentText(blocks: ContentBlock[]): ContentBlock[] {
  const merged: ContentBlock[] = [];

  for (const block of blocks) {
    const previous = merged.at(-1);
    if (previous?.type === "text" && block.type === "text") {
      previous.text = `${previous.text}\n\n${block.text}`.trim();
    } else {
      merged.push(block);
    }
  }

  return merged;
}

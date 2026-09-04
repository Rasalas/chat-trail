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
    id: `${role}-${index}-${stableId(role, visibleText || element.outerHTML.slice(0, 512))}`,
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
  await collectBlocksInOrder(root, blocks, new Set());

  return mergeAdjacentText(blocks.filter((block) => {
    if (block.type === "text") return block.text.length > 0;
    if (block.type === "code") return block.text.length > 0;
    if (block.type === "table") return block.markdown.length > 0;
    if (block.type === "quote") return block.text.length > 0;
    return block.src || block.alt;
  }));
}

export function contentToPlainText(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text" || block.type === "code" || block.type === "quote") return block.text;
      if (block.type === "table") return block.markdown;
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

export function dropContained(elements: Element[]): Element[] {
  return elements.filter(
    (element) => !elements.some((other) => other !== element && element.contains(other))
  );
}

export function selectorFor(element: Element): string {
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  if (element.id) return `#${CSS.escape(element.id)}`;
  const className = [...element.classList].slice(0, 2).map((name) => `.${CSS.escape(name)}`).join("");
  return `${element.tagName.toLowerCase()}${className}`;
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

async function collectBlocksInOrder(root: Element, blocks: ContentBlock[], seenImages: Set<Element>): Promise<void> {
  for (const child of root.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = compactWhitespace(child.textContent ?? "");
      if (text) blocks.push({ type: "text", text });
      continue;
    }

    if (!(child instanceof Element)) continue;
    if (child.matches(WALKER_IGNORED_SELECTOR)) continue;

    if (child.matches('[class*="search-image"]')) {
      await harvestImages(child, blocks, seenImages);
      continue;
    }

    if (child.matches("button")) {
      await harvestImages(child, blocks, seenImages);
      continue;
    }

    if (child.matches("hr")) {
      blocks.push({ type: "text", text: "---" });
      continue;
    }

    if (child.matches("details")) {
      const details = await detailsToText(child, seenImages);
      if (details) blocks.push({ type: "text", text: details });
      continue;
    }

    if (child.matches("ul, ol")) {
      const list = listToText(child);
      if (list) blocks.push({ type: "text", text: list });
      continue;
    }

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
      await pushImage(child as HTMLImageElement, blocks, seenImages);
      continue;
    }

    if (isProseBlock(child) && !hasBlockChildren(child)) {
      const text = formatProseBlock(child);
      if (text) blocks.push({ type: "text", text });
      continue;
    }

    await collectBlocksInOrder(child, blocks, seenImages);
  }
}

const WALKER_IGNORED_SELECTOR =
  "script, style, noscript, svg, [aria-hidden='true'], .sr-only, [class*='visually-hidden'], [role='menuitem'], [role='menu'], nav, aside, footer";

const INLINE_IGNORED_SELECTOR = `${WALKER_IGNORED_SELECTOR}, button`;

async function harvestImages(scope: Element, blocks: ContentBlock[], seenImages: Set<Element>): Promise<void> {
  for (const img of [...scope.querySelectorAll("img")]) {
    if (!seenImages.has(img)) await pushImage(img, blocks, seenImages);
  }
}

async function detailsToText(element: Element, seenImages: Set<Element>): Promise<string> {
  const summary = element.querySelector(":scope > summary");
  const summaryText = compactWhitespace(summary ? childrenInlineMarkdown(summary) : "").trim();

  const body = document.createElement("div");
  for (const node of [...element.childNodes]) {
    if (node instanceof Element && node.matches("summary")) continue;
    body.append(node.cloneNode(true));
  }

  const bodyBlocks: ContentBlock[] = [];
  await collectBlocksInOrder(body, bodyBlocks, seenImages);
  const bodyText = bodyBlocks.map(renderBlockToMarkdown).filter(Boolean).join("\n\n");

  if (!summaryText && !bodyText) return "";
  return ["<details>", `<summary>${summaryText}</summary>`, "", bodyText, "</details>"].join("\n");
}

function renderBlockToMarkdown(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "code":
      return `\`\`\`${block.language ?? ""}\n${block.text}\n\`\`\``;
    case "table":
      return block.markdown;
    case "quote":
      return quoteLines(block.text);
    case "image":
      return `![${block.alt ?? block.filename ?? "image"}](${block.src ?? block.filename ?? ""})`;
  }
}

function quoteLines(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() === "" ? ">" : `> ${line}`))
    .join("\n");
}

async function pushImage(image: HTMLImageElement, blocks: ContentBlock[], seenImages: Set<Element>): Promise<void> {
  if (seenImages.has(image)) return;
  seenImages.add(image);

  const src = image.currentSrc || image.src;
  if (src && /favicon|sprite|\/icons?\/|^data:image\/svg/i.test(src)) return;

  const rawAlt = image.alt || image.title;
  const alt = rawAlt && /^https?:\/\//i.test(rawAlt) ? undefined : rawAlt;
  const data_url = await imageToDataUrl(image);
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
}

function formatProseBlock(element: Element): string {
  const text = inlineMarkdown(element).trim();
  if (!text) return "";

  if (/^H[1-6]$/.test(element.tagName)) {
    const depth = Number(element.tagName.slice(1));
    return `${"#".repeat(Math.min(depth + 1, 6))} ${text}`;
  }

  if (element.tagName === "LI") return `- ${text}`;
  return text;
}

function listToText(list: Element, depth = 0): string {
  const ordered = list.tagName === "OL";
  let index = Number(list.getAttribute("start") ?? "1") || 1;
  const lines: string[] = [];

  for (const item of [...list.children].filter((child) => child.matches("li"))) {
    const text = listItemText(item);
    if (text) lines.push(`${"  ".repeat(depth)}${ordered ? `${index}.` : "-"} ${text}`);
    index += 1;
    for (const nested of item.querySelectorAll(":scope > ul, :scope > ol")) {
      const nestedText = listToText(nested, depth + 1);
      if (nestedText) lines.push(nestedText);
    }
  }

  return lines.join("\n");
}

function listItemText(item: Element): string {
  return compactWhitespace(
    [...item.childNodes]
      .filter((node) => !(node instanceof Element) || !node.matches("ul, ol"))
      .map((node) => inlineMarkdown(node))
      .join("")
  ).trim();
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element)) return "";
  if (node.matches(INLINE_IGNORED_SELECTOR)) return "";

  if (node.matches("br")) return "\n";
  if (node.matches("code") && !node.closest("pre")) return `\`${compactWhitespace(node.textContent ?? "")}\``;
  if (node.matches("strong, b")) return `**${compactWhitespace(childrenInlineMarkdown(node))}**`;
  if (node.matches("em, i")) return `_${compactWhitespace(childrenInlineMarkdown(node))}_`;
  if (node.matches("a[href]")) {
    const anchor = node as HTMLAnchorElement;
    const href = anchor.href;
    let text = compactWhitespace(childrenInlineMarkdown(anchor)) || href;

    if (anchor.closest("[data-testid='webpage-citation-pill']")) {
      text = citationPillLabel(anchor) || hostname(href);
      return href && !href.startsWith("javascript:") ? `[${text}](${href})` : text;
    }

    if (!href || href.startsWith("javascript:")) return text;
    return `[${text}](${href})`;
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

function citationPillLabel(anchor: HTMLAnchorElement): string {
  const leafLabels = [...anchor.querySelectorAll("span")]
    .filter((span) => !span.querySelector("span"))
    .map((span) => compactWhitespace(span.textContent ?? "").replace(/\+\d+$/, "").trim())
    .filter((label) => label.length > 0 && !/^[+\d]+$/.test(label));
  return leafLabels[0] ?? "";
}

function hostname(href: string): string {
  try {
    return new URL(href).hostname;
  } catch {
    return href;
  }
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

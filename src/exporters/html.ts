import { ConversationExport, ContentBlock } from "../shared/types";
import { escapeHtml } from "../shared/strings";

export function exportHtml(conversation: ConversationExport): string {
  const messages = conversation.messages.map((message) => {
    const body = message.content.map(renderBlock).join("\n");
    const meta = message.metadata.timestamp ? `<time>${escapeHtml(message.metadata.timestamp)}</time>` : "";
    return `<article class="message ${escapeHtml(message.role)}">
  <header><strong>${escapeHtml(message.role)}</strong>${meta}</header>
  <div class="content">${body}</div>
</article>`;
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(conversation.source.title || "Chat Export")}</title>
  <style>
    :root { color-scheme: light; font-family: ui-serif, Georgia, "Times New Roman", serif; background: #f8f6f0; color: #171717; }
    body { margin: 0; padding: 40px 18px; }
    main { max-width: 920px; margin: 0 auto; }
    .source { border-bottom: 2px solid #171717; padding-bottom: 18px; margin-bottom: 28px; }
    .source h1 { font-size: 28px; line-height: 1.1; margin: 0 0 12px; }
    .source dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; margin: 0; font-size: 13px; }
    .source dt { font-weight: 700; }
    .source dd { margin: 0; overflow-wrap: anywhere; }
    .message { border: 1px solid #d2cfc4; background: #fffefa; margin: 16px 0; padding: 18px; border-radius: 6px; }
    .message.user { border-left: 5px solid #0d6b57; }
    .message.assistant { border-left: 5px solid #9d3f2f; }
    header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; text-transform: uppercase; font: 700 12px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0; }
    time { color: #5f5b51; text-transform: none; font-weight: 400; }
    pre { white-space: pre-wrap; overflow-x: auto; padding: 14px; background: #171717; color: #f7f1df; border-radius: 4px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0; }
    th, td { border: 1px solid #c9c3b3; padding: 7px 9px; text-align: left; }
    blockquote { border-left: 3px solid #8f8774; margin: 12px 0; padding-left: 12px; color: #3f3b33; }
    a { color: #0a5f8f; }
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <main>
    <section class="source">
      <h1>${escapeHtml(conversation.source.title || "Chat Export")}</h1>
      <dl>
        <dt>Provider</dt><dd>${escapeHtml(conversation.source.provider)}</dd>
        <dt>Captured</dt><dd>${escapeHtml(conversation.source.captured_at)}</dd>
        <dt>URL</dt><dd>${escapeHtml(conversation.source.url)}</dd>
        ${conversation.source.model ? `<dt>Model</dt><dd>${escapeHtml(conversation.source.model)}</dd>` : ""}
      </dl>
    </section>
    ${messages.join("\n")}
  </main>
</body>
</html>`;
}

function renderBlock(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return `<p>${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`;
    case "code":
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    case "table":
      return markdownTableToHtml(block.markdown);
    case "quote":
      return `<blockquote>${escapeHtml(block.text)}</blockquote>`;
    case "image":
      return block.src
        ? `<figure><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt ?? "")}"><figcaption>${escapeHtml(block.filename ?? block.alt ?? "")}</figcaption></figure>`
        : `<p>${escapeHtml(block.filename ?? block.alt ?? "image")}</p>`;
    case "link":
      return `<p><a href="${escapeHtml(block.url)}">${escapeHtml(block.text)}</a></p>`;
  }
}

function markdownTableToHtml(markdown: string): string {
  const rows = markdown
    .split("\n")
    .filter((line) => !/^\|\s*-/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));

  return `<table>${rows
    .map((row, index) => {
      const tag = index === 0 ? "th" : "td";
      return `<tr>${row.map((cell) => `<${tag}>${escapeHtml(cell)}</${tag}>`).join("")}</tr>`;
    })
    .join("")}</table>`;
}

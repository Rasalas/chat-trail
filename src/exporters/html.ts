import { ConversationExport, ContentBlock } from "../shared/types";
import { escapeHtml } from "../shared/strings";
import { renderMarkdown } from "../shared/markdown";

export function exportHtml(conversation: ConversationExport): string {
  const messages = conversation.messages.map((message) => {
    const body = message.content.map(renderBlock).join("\n");
    return `<div class="message-row ${escapeHtml(message.role)}">
  <div class="message-body">${body}</div>
</div>`;
  });

  const meta = [conversation.source.provider, conversation.source.model, conversation.source.captured_at]
    .filter(Boolean)
    .map((value) => escapeHtml(String(value)))
    .join(" · ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(conversation.source.title || "Chat Export")}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f7f6f3; --fg: #1a1a1a; --muted: #6d6a63; --border: #e2dfd8;
      --bubble-user: #dcefe9; --bubble-user-fg: #12332c; --accent: #0d6b57;
      --code-bg: #f0eee9; --quote-bar: #c9c4b8;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #16181a; --fg: #e8e6e1; --muted: #9a968d; --border: #2b2e31;
        --bubble-user: #24443c; --bubble-user-fg: #d9ebe5; --accent: #35a08a;
        --code-bg: #232629; --quote-bar: #4a4d50;
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 -apple-system, "Segoe UI", system-ui, sans-serif; }
    main { max-width: 860px; margin: 0 auto; padding: 28px 20px 60px; }
    header { margin-bottom: 24px; padding-bottom: 14px; border-bottom: 1px solid var(--border); }
    h1 { margin: 0; font-size: 22px; line-height: 1.2; }
    .meta { margin: 4px 0 0; color: var(--muted); font-size: 13px; overflow-wrap: anywhere; }
    .messages { display: flex; flex-direction: column; gap: 4px; }
    .message-row { display: flex; }
    .message-row.user { justify-content: flex-end; }
    .message-body { max-width: 75%; padding: 10px 14px; border-radius: 14px; overflow-wrap: break-word; }
    .message-row.user .message-body { background: var(--bubble-user); color: var(--bubble-user-fg); border-bottom-right-radius: 4px; }
    .message-row.assistant .message-body, .message-row.system .message-body, .message-row.unknown .message-body { max-width: 100%; padding: 6px 10px; }
    .bubble-text { white-space: pre-wrap; }
    :is(h1, h2, h3, h4, h5, h6) { margin: 14px 0 6px; line-height: 1.3; font-size: 16px; }
    p { margin: 8px 0; }
    ul, ol { margin: 8px 0; padding-left: 22px; }
    li { margin: 3px 0; }
    pre { margin: 10px 0; padding: 12px; border-radius: 8px; background: var(--code-bg); overflow-x: auto; font-size: 13px; line-height: 1.45; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; background: var(--code-bg); border-radius: 4px; padding: 1px 4px; }
    pre code { background: none; padding: 0; }
    table { margin: 10px 0; border-collapse: collapse; font-size: 13.5px; }
    :is(th, td) { padding: 6px 10px; border: 1px solid var(--border); text-align: left; }
    blockquote { margin: 8px 0; padding: 2px 0 2px 12px; border-left: 3px solid var(--quote-bar); color: var(--muted); }
    img { max-width: 100%; height: auto; border-radius: 8px; }
    figure { margin: 10px 0; }
    figcaption { margin-top: 4px; color: var(--muted); font-size: 12px; }
    a { color: var(--accent); }
    hr { margin: 14px 0; border: none; border-top: 1px solid var(--border); }
    details { margin: 8px 0; }
    summary { cursor: pointer; color: var(--muted); }
    @media print {
      body { background: #fff; color: #000; }
      .message-row { break-inside: avoid; }
      .message-body { max-width: 100%; }
      .message-row.user .message-body { background: #eef5f2; color: #000; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>${escapeHtml(conversation.source.title || "Chat Export")}</h1>
      <p class="meta">${meta}${conversation.source.url ? ` · ${escapeHtml(conversation.source.url)}` : ""}</p>
    </header>
    <section class="messages">
      ${messages.join("\n")}
    </section>
  </main>
  <script>window.addEventListener("beforeprint", () => document.querySelectorAll("details").forEach((d) => (d.open = true)));</script>
</body>
</html>`;
}

function renderBlock(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return renderMarkdown(block.text);
    case "code":
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    case "table":
      return renderMarkdown(block.markdown);
    case "quote":
      return `<blockquote>${renderMarkdown(block.text)}</blockquote>`;
    case "image": {
      const label = block.filename ?? block.alt ?? "";
      const caption = label && !/^[a-z0-9_-]{32,}$/i.test(label) ? label : "";
      if (!block.src) return `<p>${escapeHtml(label || "image")}</p>`;
      const img = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt ?? "")}" loading="lazy" referrerpolicy="no-referrer">`;
      return `<figure>${img}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
    }
  }
}

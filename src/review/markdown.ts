const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => ESCAPES[character]);
}

function safeUrl(url: string): boolean {
  return /^(https?:|mailto:|#|\/)/i.test(url);
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr>");
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      out.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const parsed = parseList(lines, index, indentOf(line));
      out.push(parsed.html);
      index = parsed.next;
      continue;
    }

    const tableRows: string[] = [];
    let cursor = index;
    while (cursor < lines.length && lines[cursor].trim().startsWith("|")) {
      tableRows.push(lines[cursor]);
      cursor += 1;
    }
    if (tableRows.length >= 2 && /^\s*\|?[\s:|-]+\|?\s*$/.test(tableRows[1])) {
      out.push(tableHtml(tableRows));
      index = cursor;
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^\s*```/.test(lines[index]) &&
      !/^#{1,6}\s/.test(lines[index]) &&
      !/^\s*>/.test(lines[index]) &&
      !/^\s*[-*+]\s+/.test(lines[index]) &&
      !/^\s*\d+[.)]\s+/.test(lines[index]) &&
      !/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[index]) &&
      !lines[index].trim().startsWith("|")
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (paragraph.length > 0) {
      out.push(`<p>${paragraph.map(inline).join("<br>")}</p>`);
    } else {
      index += 1;
    }
  }

  return out.join("\n");
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isListItem(line: string): boolean {
  return /^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line);
}

function parseList(lines: string[], start: number, baseIndent: number): { html: string; next: number } {
  const ordered = /^\s*\d+[.)]\s+/.test(lines[start]);
  const items: string[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const indent = indentOf(line);
    if (isListItem(line) && indent >= baseIndent + 2 && items.length > 0) {
      const nested = parseList(lines, index, indent);
      items[items.length - 1] += nested.html;
      index = nested.next;
      continue;
    }

    if (isListItem(line) && indent >= Math.max(baseIndent - 1, 0)) {
      const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
      if (!marker.test(line)) break;
      items.push(inline(line.replace(marker, "")));
      index += 1;
      continue;
    }

    if (items.length > 0 && indent > baseIndent) {
      items[items.length - 1] += ` ${inline(line.trim())}`;
      index += 1;
      continue;
    }

    break;
  }

  const tag = ordered ? "ol" : "ul";
  return { html: `<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`, next: index };
}

function tableHtml(rows: string[]): string {
  const cells = rows
    .filter((_, rowIndex) => rowIndex !== 1)
    .map((row) =>
      row
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim())
    );

  const [header, ...body] = cells;
  if (!header) return "";
  return `<table><thead><tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead><tbody>${body
    .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
    .join("")}</tbody></table>`;
}

function inline(text: string): string {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g,
    (_match, alt: string, url: string) => (safeUrl(url) ? `<img src="${url}" alt="${alt}" loading="lazy">` : alt)
  );
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_match, label: string, url: string) =>
    safeUrl(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : label
  );
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return out;
}

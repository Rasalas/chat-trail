import DOMPurify from "dompurify";

const CONTENT_TAGS = [
  "a", "p", "br", "hr", "div", "span", "section", "article", "main", "header", "footer", "nav", "aside",
  "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "del", "sup", "sub",
  "pre", "code", "blockquote", "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot",
  "tr", "th", "td", "caption", "figure", "figcaption", "img", "details", "summary"
];

export function sanitizeContentHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: CONTENT_TAGS,
    ALLOWED_ATTR: ["href", "src", "alt", "title", "open", "start", "colspan", "rowspan", "loading", "referrerpolicy", "target", "rel", "data-fallback", "class"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false
  });
}

import { sanitizeContentHtml } from "../shared/sanitize";
import { escapeHtml } from "../shared/strings";

export function snapshotDocument(document: Document): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  removePrivateContent(document.body, clone);
  const body = sanitizeContentHtml(clone.innerHTML);
  // A saved snapshot is inert and does not fetch the page's remote resources.
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(document.title)}</title></head><body>${body}</body></html>`;
}

function removePrivateContent(original: Element, clone: Element): void {
  const children = [...original.children];
  const clonedChildren = [...clone.children];
  for (const [index, child] of children.entries()) {
    const copy = clonedChildren[index];
    const style = child.ownerDocument.defaultView?.getComputedStyle(child);
    if (child.matches("script, style, noscript, template, iframe, object, embed, input, textarea, select, [hidden], [aria-hidden='true'], .sr-only, [class*='visually-hidden']") ||
        style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse" || style?.opacity === "0") {
      copy.remove();
      continue;
    }
    removePrivateContent(child, copy);
  }
}

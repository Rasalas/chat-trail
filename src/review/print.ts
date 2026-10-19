const CLEANUP_FALLBACK_MS = 60_000;

/** Prints via a hidden same-origin iframe; an inline print script in a blob page would be blocked by the extension CSP. */
export function printHtml(document: Document, html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";

    let cleanupTimer: number | undefined;
    const cleanup = () => {
      window.clearTimeout(cleanupTimer);
      frame.remove();
    };

    frame.addEventListener("load", () => {
      const view = frame.contentWindow;
      if (!view) {
        cleanup();
        reject(new Error("The print view could not be opened."));
        return;
      }
      view.document.querySelectorAll("details").forEach((details) => {
        details.open = true;
      });
      view.addEventListener("afterprint", cleanup, { once: true });
      cleanupTimer = window.setTimeout(cleanup, CLEANUP_FALLBACK_MS);
      try {
        view.focus();
        view.print();
        resolve();
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }, { once: true });

    frame.srcdoc = html;
    document.body.append(frame);
  });
}

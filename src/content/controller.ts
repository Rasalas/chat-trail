import { applyExportOptions } from "../exporters/filter";
import { exportMarkdown } from "../exporters/markdown";
import { captureWarning } from "../shared/capture";
import { slugify } from "../shared/strings";
import {
  BackgroundRequest,
  CaptureAction,
  ContentRequest,
  ContentResponse,
  ConversationExport,
  DEFAULT_EXPORT_OPTIONS,
  ExportOptions,
  ExtractionResult
} from "../shared/types";
import { PillHandle } from "./progress-pill";
import { CaptureProgress } from "./scroll-capture";

export const CAPTURE_CANCELLED = "Capture cancelled.";
export const SELECTION_CANCELLED = "Container selection cancelled.";
export const CAPTURE_GONE = "This capture is no longer available in the source tab. Click Refresh to capture it again.";
// Results stay in page memory (not chrome.storage) because image data URLs easily exceed the session quota.
const MAX_STORED_CAPTURES = 5;

export interface ContentDeps {
  capture(options: { useProviderCopy: boolean; signal: AbortSignal; onProgress(progress: CaptureProgress): void }): Promise<ExtractionResult>;
  pickContainer(): Promise<Element>;
  extractContainer(container: Element): Promise<ConversationExport>;
  snapshotHtml(): string;
  currentUrl(): string;
  sendBackground(message: BackgroundRequest): Promise<{ ok?: boolean; error?: string; sessionId?: string } | undefined>;
  download(text: string, filename: string): void;
  writeClipboard(text: string): Promise<void>;
  storedOptions(): Promise<Partial<ExportOptions>>;
  createPill(handlers: { onCancel(): void; onCopy(): void }): PillHandle;
  newId(): string;
}

export function createContentController(deps: ContentDeps) {
  const results = new Map<string, ExtractionResult>();
  let running: AbortController | null = null;
  let selecting = false;
  let pendingCopy: { text: string; done: string } | null = null;
  const pill = deps.createPill({
    onCancel: () => running?.abort(new Error(CAPTURE_CANCELLED)),
    onCopy: () => void copyPending()
  });

  const busy = () => running !== null || selecting;
  const busyError = { ok: false as const, error: "A capture is already running on this page. Wait for it to finish." };

  async function handleMessage<Request extends ContentRequest>(request: Request): Promise<ContentResponse<ContentRequest>> {
    switch (request.type) {
      case "START_CAPTURE":
        if (busy()) return busyError;
        void runAction(request.action);
        return { ok: true, started: true };
      case "RUN_CAPTURE": {
        if (busy()) return busyError;
        try {
          const result = await capture(Boolean(request.useProviderCopy));
          const captureId = store(result);
          pill.show({ kind: "done", text: `Captured ${result.conversation.messages.length} messages. Returning to the review…` });
          return { ok: true, captureId };
        } catch (error) {
          showFailure(error);
          throw error;
        }
      }
      case "GET_CAPTURE_RESULT":
        return results.get(request.captureId) ?? { ok: false, error: CAPTURE_GONE };
      case "GET_HTML_SNAPSHOT":
        if (request.expectedUrl !== deps.currentUrl()) throw new Error("The source page has changed. Refresh the review first.");
        return { ok: true, html: deps.snapshotHtml() };
      case "START_CONTAINER_SELECTION":
        if (busy()) return busyError;
        void selectContainer();
        return { ok: true, selecting: true };
      default:
        throw new Error("Unknown content request.");
    }
  }

  async function capture(useProviderCopy: boolean): Promise<ExtractionResult> {
    const controller = new AbortController();
    running = controller;
    const sourceUrl = deps.currentUrl();
    try {
      pill.show({ kind: "loading", round: 1 });
      const result = await deps.capture({
        useProviderCopy,
        signal: controller.signal,
        onProgress: (progress) =>
          pill.show(progress.phase === "loading" ? { kind: "loading", round: progress.round } : { kind: "reading", count: progress.count })
      });
      if (deps.currentUrl() !== sourceUrl) throw new Error("The source page changed during capture. Please try again.");
      return result;
    } finally {
      running = null;
    }
  }

  async function runAction(action: CaptureAction): Promise<void> {
    try {
      const options = action === "review" ? await deps.storedOptions() : {};
      const result = await capture(Boolean(options.useProviderCopy));
      if (action === "review") {
        await openReview(result);
        return;
      }

      const filtered = applyExportOptions(result.conversation, DEFAULT_EXPORT_OPTIONS);
      const markdown = exportMarkdown(filtered);
      const warning = captureWarning(filtered);
      const count = filtered.messages.length;
      if (action === "download") {
        deps.download(markdown, `${slugify(filtered.source.title)}.md`);
        pill.show(warning
          ? { kind: "warning", text: `Saved ${count} messages. ${warning}` }
          : { kind: "done", text: `Saved ${count} messages from ${result.adapterLabel}.` });
        return;
      }

      const done = warning ? `Copied ${count} messages. ${warning}` : `Copied ${count} messages as Markdown.`;
      try {
        await deps.writeClipboard(markdown);
        pill.show({ kind: warning ? "warning" : "done", text: done });
      } catch {
        // Clipboard writes need focus or a user gesture; the pill button provides both.
        pendingCopy = { text: markdown, done };
        pill.show({ kind: "copy", text: `${count} messages ready.` });
      }
    } catch (error) {
      showFailure(error);
    }
  }

  async function copyPending(): Promise<void> {
    if (!pendingCopy) return;
    try {
      await deps.writeClipboard(pendingCopy.text);
      pill.show({ kind: "done", text: pendingCopy.done });
      pendingCopy = null;
    } catch (error) {
      showFailure(error);
    }
  }

  async function selectContainer(): Promise<void> {
    selecting = true;
    try {
      const container = await deps.pickContainer();
      pill.show({ kind: "working", text: "Reading selected area…" });
      const conversation = await deps.extractContainer(container);
      await openReview({ ok: true, conversation, adapterId: "generic", adapterLabel: "Selected web content" });
    } catch (error) {
      if (error instanceof Error && error.message === SELECTION_CANCELLED) return;
      showFailure(error);
    } finally {
      selecting = false;
    }
  }

  async function openReview(result: ExtractionResult): Promise<void> {
    const captureId = store(result);
    pill.show({ kind: "working", text: "Opening review…" });
    const response = await deps.sendBackground({ type: "OPEN_REVIEW", captureId });
    if (!response?.ok) throw new Error(response?.error || "The extension background service did not respond.");
    const warning = captureWarning(result.conversation);
    const count = result.conversation.messages.length;
    pill.show(warning
      ? { kind: "warning", text: `Captured ${count} messages for review. ${warning}` }
      : { kind: "done", text: `Captured ${count} messages. The review opened in a new tab.` });
  }

  function store(result: ExtractionResult): string {
    const captureId = deps.newId();
    results.set(captureId, result);
    while (results.size > MAX_STORED_CAPTURES) results.delete(results.keys().next().value!);
    return captureId;
  }

  function showFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    pill.show(message === CAPTURE_CANCELLED ? { kind: "done", text: CAPTURE_CANCELLED } : { kind: "error", text: message });
  }

  return { handleMessage };
}

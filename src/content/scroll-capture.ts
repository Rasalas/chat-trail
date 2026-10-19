import { setProviderCopyEnabled } from "../normalizer/copy-enhancement";
import { ChatAdapter, ChatMessage, ConversationExport } from "../shared/types";

const IDLE_QUIET_MS = 250;
const IDLE_MAX_MS = 2500;
const LOAD_MIN_WAIT_MS = 400;
const LOAD_CONFIRM_WAIT_MS = 1500;
const LOAD_MAX_ROUNDS = 60;
const WALK_MAX_STEPS = 200;

const GENERIC_MESSAGE_SELECTOR = "[data-message-author-role], [data-testid='transcript-row'], article, [role='listitem']";

export type CaptureProgress = { phase: "loading"; round: number } | { phase: "reading"; count: number };

export interface ScrollCaptureOptions {
  useProviderCopy?: boolean;
  /** Aborting stops between rounds/steps; the promise rejects with `signal.reason`. */
  signal?: AbortSignal;
  onProgress?: (progress: CaptureProgress) => void;
}

export async function extractWithScrollCapture(
  adapter: ChatAdapter,
  document: Document,
  options: ScrollCaptureOptions = {}
): Promise<ConversationExport> {
  const messageRoots = () => {
    const roots = adapter.messageElements?.(document);
    return roots?.length ? roots : genericMessageElements(document);
  };
  options.signal?.throwIfAborted();
  const scroller = findScroller(document, messageRoots());
  const originalTop = scroller.scrollTop;
  const wasAtBottom = originalTop >= maxScrollTop(scroller) - 1;
  setProviderCopyEnabled(Boolean(options.useProviderCopy));
  try {
    const loaded = await loadOlderMessages(scroller, messageRoots, options);
    const { snapshots, reachedBottom } = await walkAndExtract(adapter, document, scroller, messageRoots, options);
    const reasons: NonNullable<ConversationExport["capture"]>["reasons"] = [];
    if (!loaded) reasons.push("load-limit");
    if (!reachedBottom) reasons.push("walk-limit");
    return { ...mergeSnapshots(snapshots), capture: { status: reasons.length ? "incomplete" : "complete", reasons } };
  } finally {
    // Loading older turns grows the thread, so the bottom moves.
    scroller.scrollTop = wasAtBottom ? maxScrollTop(scroller) : Math.min(originalTop, maxScrollTop(scroller));
    setProviderCopyEnabled(false);
  }
}

// Providers paginate upwards: hitting the top fetches older turns and prepends them.
async function loadOlderMessages(
  scroller: HTMLElement,
  messageRoots: () => Element[],
  { signal, onProgress }: ScrollCaptureOptions
): Promise<boolean> {
  let stableRounds = 0;
  for (let round = 0; round < LOAD_MAX_ROUNDS; round += 1) {
    signal?.throwIfAborted();
    onProgress?.({ phase: "loading", round: round + 1 });
    const before = topSignature(scroller, messageRoots());
    scroller.scrollTop = 0;
    // Slow providers (Gemini) answer the top-reached fetch after >1s, so confirm "nothing more" patiently.
    await waitForDomIdle(scroller, { min: stableRounds > 0 ? LOAD_CONFIRM_WAIT_MS : LOAD_MIN_WAIT_MS, signal });
    signal?.throwIfAborted();

    const after = topSignature(scroller, messageRoots());
    if (scroller.scrollTop <= 1 && before === after) {
      stableRounds += 1;
      if (stableRounds >= 2) return true;
    } else {
      stableRounds = 0;
    }
  }
  return false;
}

// Virtualised lists only render turns near the viewport, so we snapshot while walking down.
async function walkAndExtract(
  adapter: ChatAdapter,
  document: Document,
  scroller: HTMLElement,
  messageRoots: () => Element[],
  { signal, onProgress }: ScrollCaptureOptions
): Promise<{ snapshots: ConversationExport[]; reachedBottom: boolean }> {
  const snapshots: ConversationExport[] = [];
  const seen = new Set<string>();
  let rendered = "";
  let bottomRounds = 0;

  scroller.scrollTop = 0;
  await waitForDomIdle(scroller, { signal });

  for (let step = 0; step < WALK_MAX_STEPS; step += 1) {
    signal?.throwIfAborted();
    const roots = messageRoots();
    // Virtualisers can reuse the same elements for different messages.
    const signature = JSON.stringify(roots.map((root) => root.outerHTML));
    if (snapshots.length === 0 || roots.length === 0 || rendered !== signature || bottomRounds > 0) {
      const snapshot = await adapter.extract(document);
      snapshots.push(snapshot);
      rendered = signature;
      // Approximate running count for progress only; the merge decides the real result.
      for (const message of snapshot.messages) {
        seen.add(`${message.role}:${message.metadata.providerMessageId ?? message.metadata.visibleTextHash ?? message.id}`);
      }
      onProgress?.({ phase: "reading", count: seen.size });
    }

    const maxTop = maxScrollTop(scroller);
    if (scroller.scrollTop >= maxTop - 1) {
      bottomRounds += 1;
      if (bottomRounds >= 2) return { snapshots, reachedBottom: true };
    } else {
      bottomRounds = 0;
    }

    const stride = Math.max(420, Math.floor(scroller.clientHeight * 0.8));
    scroller.scrollTop = Math.min(maxTop, scroller.scrollTop + stride);
    await waitForDomIdle(scroller, { signal });
  }

  return { snapshots, reachedBottom: false };
}

function findScroller(document: Document, roots: Element[]): HTMLElement {
  for (let element = roots[0]?.parentElement ?? null; element; element = element.parentElement) {
    if (isScrollable(element)) return element;
  }
  return findPrimaryScrollerHeuristic(document);
}

function isScrollable(element: HTMLElement): boolean {
  if (element.scrollHeight <= element.clientHeight + 10) return false;
  if (element === element.ownerDocument.scrollingElement) return true;
  return /(auto|scroll)/.test(getComputedStyle(element).overflowY);
}

function findPrimaryScrollerHeuristic(document: Document): HTMLElement {
  const scrollingElement = document.scrollingElement as HTMLElement | null;
  const candidates = [
    scrollingElement,
    ...document.querySelectorAll<HTMLElement>("main, [role='main'], [class*='chat' i], [class*='conversation' i], body > div")
  ].filter((element): element is HTMLElement => Boolean(element));

  return candidates
    .map((element) => ({ element, score: scrollScore(element) }))
    .sort((a, b) => b.score - a.score)[0]?.element ?? document.documentElement;
}

function scrollScore(element: HTMLElement): number {
  const overflow = getComputedStyle(element).overflowY;
  const canScroll = element.scrollHeight > element.clientHeight + 80;
  const textLength = element.textContent?.length ?? 0;
  return (canScroll ? 1000 : 0) + (/(auto|scroll)/.test(overflow) ? 300 : 0) + Math.min(textLength / 1000, 100);
}

function genericMessageElements(document: Document): Element[] {
  return [...document.querySelectorAll(GENERIC_MESSAGE_SELECTOR)];
}

function maxScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function topSignature(scroller: HTMLElement, roots: Element[]): string {
  const first = roots[0];
  const id = first?.getAttribute("data-message-id") ?? first?.getAttribute("data-testid") ?? "";
  return `${roots.length}:${id}:${scroller.scrollHeight}`;
}

// Resolves once the subtree stayed quiet for `quiet` ms (after at least `min` ms), or at `max` ms.
export function waitForDomIdle(
  root: Node,
  { quiet = IDLE_QUIET_MS, max = IDLE_MAX_MS, min = 0, signal }: { quiet?: number; max?: number; min?: number; signal?: AbortSignal } = {}
): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    let quietTimer: number | undefined;

    const finish = () => {
      window.clearTimeout(quietTimer);
      window.clearTimeout(maxTimer);
      observer.disconnect();
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const armQuiet = () => {
      window.clearTimeout(quietTimer);
      const remainingMin = Math.max(0, min - (Date.now() - started));
      quietTimer = window.setTimeout(finish, Math.max(quiet, remainingMin));
    };

    const observer = new MutationObserver(armQuiet);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    const maxTimer = window.setTimeout(finish, max);
    if (signal?.aborted) return finish();
    signal?.addEventListener("abort", finish);
    armQuiet();
  });
}

// Snapshots overlap; unknown messages are inserted right after the nearest already-known predecessor.
export function mergeSnapshots(snapshots: ConversationExport[]): ConversationExport {
  const base = snapshots.at(-1) ?? snapshots[0];
  if (!base) {
    throw new Error("No conversation snapshots captured.");
  }

  // `order` holds unique keys; repeated texts without provider ids get a `#n` suffix.
  const order: string[] = [];
  const baseKeys = new Map<string, string>();
  const copies = new Map<string, number>();
  const byKey = new Map<string, ChatMessage>();
  let floorKey: string | undefined;

  const locate = (message: ChatMessage, after: number, floor: number): number => {
    const key = messageKey(message);
    if (message.metadata.providerMessageId) return order.indexOf(key);
    // Equal texts can repeat, so match the next copy after the cursor; the walk only moves down.
    for (let index = Math.max(after + 1, floor); index < order.length; index += 1) {
      if (baseKeys.get(order[index]) === key) return index;
    }
    return -1;
  };

  const uniqueKey = (key: string): string => {
    const count = (copies.get(key) ?? 0) + 1;
    const unique = count === 1 ? key : `${key}#${count}`;
    copies.set(key, count);
    baseKeys.set(unique, key);
    return unique;
  };

  for (const snapshot of snapshots) {
    const floor = floorKey === undefined ? 0 : Math.max(0, order.indexOf(floorKey));
    const firstKnown = snapshot.messages.map((message) => locate(message, floor - 1, floor)).find((position) => position !== -1);
    let anchor = firstKnown === undefined ? order.length - 1 : firstKnown - 1;
    let first: string | undefined;

    for (const message of snapshot.messages) {
      const known = locate(message, anchor, floor);
      let key: string;
      if (known !== -1) {
        key = order[known];
        anchor = known;
      } else {
        key = uniqueKey(messageKey(message));
        order.splice(anchor + 1, 0, key);
        anchor += 1;
      }
      byKey.set(key, message);
      first ??= key;
    }
    if (first !== undefined) floorKey = first;
  }

  const messages = order.map((key, index) => {
    const message = byKey.get(key)!;
    return { ...message, id: `message-${index + 1}`, metadata: { ...message.metadata, index } };
  });

  return {
    ...base,
    messages,
    manifest: {
      ...base.manifest,
      hashes: {
        ...base.manifest.hashes
      }
    }
  };
}

function messageKey(message: ChatMessage): string {
  const kind = message.kind ?? "message";
  if (message.metadata.providerMessageId) return `${kind}:${message.role}:${message.metadata.providerMessageId}`;
  if (message.metadata.visibleTextHash) return `${kind}:${message.role}:${message.metadata.visibleTextHash}`;
  return `${kind}:${message.role}:${plainKey(message)}`;
}

function plainKey(message: ChatMessage): string {
  return message.content
    .map((block) => {
      if (block.type === "text" || block.type === "code" || block.type === "quote") return block.text;
      if (block.type === "table") return block.markdown;
      return `${block.alt ?? ""}:${block.src ?? ""}:${block.filename ?? ""}`;
    })
    .join("\n")
    .slice(0, 500);
}

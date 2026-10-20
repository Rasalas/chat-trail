import { setProviderCopyEnabled } from "../normalizer/copy-enhancement";
import { beginImageCache, endImageCache } from "../normalizer/dom";
import { stableId } from "../shared/hash";
import { ChatAdapter, ChatMessage, ConversationExport, ScrollBehaviour } from "../shared/types";

const IDLE_QUIET_MS = 250;
const IDLE_MAX_MS = 2500;
const LOAD_MIN_WAIT_MS = 400;
const LOAD_CONFIRM_WAIT_MS = 1500;
const LOAD_MAX_ROUNDS = 60;
const MIN_STRIDE_PX = 420;
// The walk budget follows the thread height (twice the steps it needs, plus slack); the cap only stops pages
// that keep growing while we walk.
const WALK_STEP_SLACK = 20;
const WALK_MAX_STEPS = 3000;
// Steps in a row in which setting scrollTop moved nothing (the page pins the view or ignores it).
const WALK_STUCK_STEPS = 3;

// Unknown pages may do either, so they get the full (slow) treatment.
const UNKNOWN_SCROLL: ScrollBehaviour = { loadsOlderOnTop: true, virtualised: true };

const GENERIC_MESSAGE_SELECTOR = "[data-message-author-role], [data-testid='transcript-row'], article, [role='listitem']";

export type CaptureProgress = { phase: "loading"; round: number } | { phase: "reading"; count: number };

export interface ScrollCaptureOptions {
  useProviderCopy?: boolean;
  /** Aborting stops between rounds/steps; the promise rejects with `signal.reason`. */
  signal?: AbortSignal;
  onProgress?: (progress: CaptureProgress) => void;
}

interface Extracted {
  snapshots: ConversationExport[];
  /** Per snapshot, the scroll-content top of each message (same order), when the DOM mapped 1:1. */
  tops?: Array<number[] | undefined>;
  reachedBottom: boolean;
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
  const scroll = adapter.scroll ?? UNKNOWN_SCROLL;
  options.signal?.throwIfAborted();
  const scroller = findScroller(document, messageRoots());
  const originalTop = scroller.scrollTop;
  const wasAtBottom = originalTop >= maxScrollTop(scroller) - 1;
  setProviderCopyEnabled(Boolean(options.useProviderCopy));
  beginImageCache();
  try {
    const loaded = scroll.loadsOlderOnTop ? await loadOlderMessages(scroller, messageRoots, options) : true;
    // Without virtualisation every loaded turn is mounted, so one extraction sees them all.
    const { snapshots, tops, reachedBottom } = scroll.virtualised
      ? await walkAndExtract(adapter, document, scroller, messageRoots, options)
      : await extractOnce(adapter, document, options);
    const reasons: NonNullable<ConversationExport["capture"]>["reasons"] = [];
    if (!loaded) reasons.push("load-limit");
    if (!reachedBottom) reasons.push("walk-limit");
    return { ...mergeSnapshots(snapshots, tops), capture: { status: reasons.length ? "incomplete" : "complete", reasons } };
  } finally {
    // Loading older turns grows the thread, so the bottom moves.
    scroller.scrollTop = wasAtBottom ? maxScrollTop(scroller) : Math.min(originalTop, maxScrollTop(scroller));
    setProviderCopyEnabled(false);
    endImageCache();
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

async function extractOnce(
  adapter: ChatAdapter,
  document: Document,
  { signal, onProgress }: ScrollCaptureOptions
): Promise<Extracted> {
  signal?.throwIfAborted();
  const snapshot = await adapter.extract(document);
  onProgress?.({ phase: "reading", count: snapshot.messages.length });
  return { snapshots: [snapshot], reachedBottom: true };
}

// Virtualised lists only render turns near the viewport, so we snapshot while walking down.
async function walkAndExtract(
  adapter: ChatAdapter,
  document: Document,
  scroller: HTMLElement,
  messageRoots: () => Element[],
  { signal, onProgress }: ScrollCaptureOptions
): Promise<Extracted> {
  const snapshots: ConversationExport[] = [];
  const tops: Array<number[] | undefined> = [];
  const seen = new Set<string>();
  let rendered = "";
  let bottomRounds = 0;
  let stuckSteps = 0;

  // After loading older turns the view is already at the top and the DOM is idle.
  if (scroller.scrollTop > 0) {
    scroller.scrollTop = 0;
    await waitForDomIdle(scroller, { signal });
  }

  for (let step = 0; step < walkBudget(scroller); step += 1) {
    signal?.throwIfAborted();
    const roots = messageRoots();
    const signature = renderedSignature(scroller, roots);
    if (snapshots.length === 0 || roots.length === 0 || rendered !== signature || bottomRounds > 0) {
      const snapshot = await adapter.extract(document);
      snapshots.push(snapshot);
      tops.push(messageTops(scroller, messageRoots(), snapshot.messages));
      rendered = signature;
      // Approximate running count for progress only; the merge decides the real result.
      for (const message of snapshot.messages) {
        seen.add(`${message.role}:${message.metadata.providerMessageId ?? message.metadata.visibleTextHash ?? message.id}`);
      }
      onProgress?.({ phase: "reading", count: seen.size });
    }

    const maxTop = maxScrollTop(scroller);
    const before = scroller.scrollTop;
    if (before >= maxTop - 1) {
      bottomRounds += 1;
      if (bottomRounds >= 2) return { snapshots, tops, reachedBottom: true };
    } else {
      bottomRounds = 0;
    }

    scroller.scrollTop = Math.min(maxTop, before + stride(scroller));
    await waitForDomIdle(scroller, { signal });

    if (bottomRounds === 0 && scroller.scrollTop <= before) {
      stuckSteps += 1;
      if (stuckSteps >= WALK_STUCK_STEPS) break;
    } else {
      stuckSteps = 0;
    }
  }

  return { snapshots, tops, reachedBottom: false };
}

// Positions tell repeated texts apart ("continue", identical replies). Only trusted when every root
// visibly holds the message at the same index.
function messageTops(scroller: HTMLElement, roots: Element[], messages: ChatMessage[]): number[] | undefined {
  if (roots.length === 0 || roots.length !== messages.length) return undefined;
  const tops: number[] = [];
  for (const [index, root] of roots.entries()) {
    const text = messages[index].content.find((block) => block.type === "text")?.text;
    const probe = text ? compact(text).slice(0, 40) : "";
    if (probe && !compact(root.textContent ?? "").includes(probe)) return undefined;
    tops.push(contentTop(scroller, root));
  }
  return tops;
}

// Position inside the scrolled content, so it does not change while scrolling.
function contentTop(scroller: HTMLElement, element: Element): number {
  const isRoot = scroller === scroller.ownerDocument.scrollingElement;
  return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + (isRoot ? 0 : scroller.scrollTop);
}

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stride(scroller: HTMLElement): number {
  return Math.max(MIN_STRIDE_PX, Math.floor(scroller.clientHeight * 0.8));
}

// Recomputed every step because loading or lazy content can still grow the thread.
function walkBudget(scroller: HTMLElement): number {
  return Math.min(WALK_MAX_STEPS, Math.ceil(scroller.scrollHeight / stride(scroller)) * 2 + WALK_STEP_SLACK);
}

// Far cheaper than serialising outerHTML; the text/image hash still catches a virtualiser that reuses an
// element for a different message. The first row's place tells apart windows of identical messages.
function renderedSignature(scroller: HTMLElement, roots: Element[]): string {
  const place = roots[0] ? Math.round(contentTop(scroller, roots[0])) : 0;
  return `${place}@` + roots
    .map((root) => {
      const id = root.getAttribute("data-message-id") ?? root.getAttribute("data-index") ?? root.id;
      const images = [...root.querySelectorAll("img")].map((image) => image.currentSrc || image.src).join(" ");
      return `${id}:${root.childElementCount}:${stableId("r", `${root.textContent ?? ""}\n${images}`)}`;
    })
    .join("|");
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
// Without provider ids equal texts are ambiguous, so `tops` (see messageTops) pick the copy at the same
// place; a uniform shift (content above grew) is measured from unambiguous messages and subtracted.
export function mergeSnapshots(snapshots: ConversationExport[], tops: Array<number[] | undefined> = []): ConversationExport {
  const base = snapshots.at(-1) ?? snapshots[0];
  if (!base) {
    throw new Error("No conversation snapshots captured.");
  }

  // `order` holds unique keys; repeated texts without provider ids get a `#n` suffix.
  const order: string[] = [];
  const baseKeys = new Map<string, string>();
  const copies = new Map<string, number>();
  const byKey = new Map<string, ChatMessage>();
  const topByKey = new Map<string, number>();
  let floorKey: string | undefined;

  const locate = (message: ChatMessage, after: number, floor: number, top?: { at: number; tolerance: number }): number => {
    const key = messageKey(message);
    if (message.metadata.providerMessageId) return order.indexOf(key);
    // Equal texts can repeat, so match the next copy after the cursor; the walk only moves down.
    for (let index = Math.max(after + 1, floor); index < order.length; index += 1) {
      if (baseKeys.get(order[index]) !== key) continue;
      const known = topByKey.get(order[index]);
      if (top === undefined || known === undefined || Math.abs(known - top.at) <= top.tolerance) return index;
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

  for (const [snapshotIndex, snapshot] of snapshots.entries()) {
    const positions = positionsFor(snapshot.messages, tops[snapshotIndex], (key) => (copies.get(key) === 1 ? topByKey.get(key) : undefined));
    const floor = floorKey === undefined ? 0 : Math.max(0, order.indexOf(floorKey));
    const firstKnown = snapshot.messages
      .map((message, index) => locate(message, floor - 1, floor, positions?.[index]))
      .find((position) => position !== -1);
    let anchor = firstKnown === undefined ? order.length - 1 : firstKnown - 1;
    let first: string | undefined;

    for (const [index, message] of snapshot.messages.entries()) {
      const known = locate(message, anchor, floor, positions?.[index]);
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
      if (positions) topByKey.set(key, positions[index].at);
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

// Shifts a snapshot's tops into the coordinates already recorded and allows half a message of drift.
function positionsFor(
  messages: ChatMessage[],
  tops: number[] | undefined,
  uniqueTop: (key: string) => number | undefined
): Array<{ at: number; tolerance: number }> | undefined {
  if (!tops || tops.length !== messages.length) return undefined;
  const keys = messages.map(messageKey);
  const shifts = keys
    .map((key, index) => {
      const known = keys.indexOf(key) === keys.lastIndexOf(key) ? uniqueTop(key) : undefined;
      return known === undefined ? undefined : tops[index] - known;
    })
    .filter((shift): shift is number => shift !== undefined)
    .sort((a, b) => a - b);
  const shift = shifts.length ? shifts[Math.floor(shifts.length / 2)] : 0;
  return tops.map((top, index) => {
    const gap = (tops[index + 1] ?? Infinity) - top;
    const height = Number.isFinite(gap) && gap > 0 ? gap : (top - (tops[index - 1] ?? top)) || 0;
    return { at: top - shift, tolerance: Math.max(12, height / 2) };
  });
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

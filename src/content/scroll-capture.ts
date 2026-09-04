import { setProviderCopyEnabled } from "../normalizer/copy-enhancement";
import { ChatAdapter, ChatMessage, ConversationExport } from "../shared/types";

const IDLE_QUIET_MS = 250;
const IDLE_MAX_MS = 2500;
const LOAD_MIN_WAIT_MS = 400;
const LOAD_CONFIRM_WAIT_MS = 1500;
const LOAD_MAX_ROUNDS = 60;
const WALK_MAX_STEPS = 200;

const GENERIC_MESSAGE_SELECTOR = "[data-message-author-role], [data-testid='transcript-row'], article, [role='listitem']";

export async function extractWithScrollCapture(
  adapter: ChatAdapter,
  document: Document,
  options: { useProviderCopy?: boolean } = {}
): Promise<ConversationExport> {
  const messageRoots = () => {
    const roots = adapter.messageElements?.(document);
    return roots?.length ? roots : genericMessageElements(document);
  };
  const scroller = findScroller(document, messageRoots());
  const originalTop = scroller.scrollTop;
  const wasAtBottom = originalTop >= maxScrollTop(scroller) - 1;
  setProviderCopyEnabled(Boolean(options.useProviderCopy));
  try {
    const loaded = await loadOlderMessages(scroller, messageRoots);
    const { snapshots, reachedBottom } = await walkAndExtract(adapter, document, scroller, messageRoots);
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
async function loadOlderMessages(scroller: HTMLElement, messageRoots: () => Element[]): Promise<boolean> {
  let stableRounds = 0;
  for (let round = 0; round < LOAD_MAX_ROUNDS; round += 1) {
    const before = topSignature(scroller, messageRoots());
    scroller.scrollTop = 0;
    // Slow providers (Gemini) answer the top-reached fetch after >1s, so confirm "nothing more" patiently.
    await waitForDomIdle(scroller, { min: stableRounds > 0 ? LOAD_CONFIRM_WAIT_MS : LOAD_MIN_WAIT_MS });

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
  messageRoots: () => Element[]
): Promise<{ snapshots: ConversationExport[]; reachedBottom: boolean }> {
  const snapshots: ConversationExport[] = [];
  let rendered = "";
  let bottomRounds = 0;

  scroller.scrollTop = 0;
  await waitForDomIdle(scroller);

  for (let step = 0; step < WALK_MAX_STEPS; step += 1) {
    const roots = messageRoots();
    // Virtualisers can reuse the same elements for different messages.
    const signature = JSON.stringify(roots.map((root) => root.outerHTML));
    if (snapshots.length === 0 || roots.length === 0 || rendered !== signature || bottomRounds > 0) {
      snapshots.push(await adapter.extract(document));
      rendered = signature;
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
    await waitForDomIdle(scroller);
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
  { quiet = IDLE_QUIET_MS, max = IDLE_MAX_MS, min = 0 }: { quiet?: number; max?: number; min?: number } = {}
): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    let quietTimer: number | undefined;

    const finish = () => {
      window.clearTimeout(quietTimer);
      window.clearTimeout(maxTimer);
      observer.disconnect();
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
    armQuiet();
  });
}

// Snapshots overlap; unknown messages are inserted right after the nearest already-known predecessor.
export function mergeSnapshots(snapshots: ConversationExport[]): ConversationExport {
  const base = snapshots.at(-1) ?? snapshots[0];
  if (!base) {
    throw new Error("No conversation snapshots captured.");
  }

  const order: string[] = [];
  const byKey = new Map<string, ChatMessage>();

  for (const snapshot of snapshots) {
    const firstKnown = snapshot.messages.map(messageKey).find((key) => byKey.has(key));
    let anchor = firstKnown === undefined ? order.length - 1 : order.indexOf(firstKnown) - 1;
    for (const message of snapshot.messages) {
      const key = messageKey(message);
      const known = order.indexOf(key);
      if (known !== -1) {
        byKey.set(key, message);
        anchor = known;
        continue;
      }
      order.splice(anchor + 1, 0, key);
      byKey.set(key, message);
      anchor += 1;
    }
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

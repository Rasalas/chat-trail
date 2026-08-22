import { setProviderCopyEnabled } from "../normalizer/copy-enhancement";
import { ChatAdapter, ChatMessage, ConversationExport } from "../shared/types";

const SCROLL_SETTLE_MS = 450;
const MAX_STEPS = 90;

export async function extractWithScrollCapture(
  adapter: ChatAdapter,
  document: Document,
  options: { useProviderCopy?: boolean } = {}
): Promise<ConversationExport> {
  setProviderCopyEnabled(Boolean(options.useProviderCopy));
  try {
    const scroller = findPrimaryScroller(document);
    const originalTop = scroller.scrollTop;
    const snapshots: ConversationExport[] = [];

    await scrollAndWait(scroller, 0);

    let previousTop = -1;
    let stableSteps = 0;

    for (let step = 0; step < MAX_STEPS; step += 1) {
      snapshots.push(await adapter.extract(document));

      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const nextTop = Math.min(maxTop, scroller.scrollTop + Math.max(420, Math.floor(scroller.clientHeight * 0.82)));

      if (nextTop === previousTop || nextTop >= maxTop) {
        stableSteps += 1;
      } else {
        stableSteps = 0;
      }

      if (stableSteps >= 2) break;

      previousTop = nextTop;
      await scrollAndWait(scroller, nextTop);
    }

    await scrollAndWait(scroller, Math.min(originalTop, Math.max(0, scroller.scrollHeight - scroller.clientHeight)), 120);

    return mergeSnapshots(snapshots);
  } finally {
    setProviderCopyEnabled(false);
  }
}

function findPrimaryScroller(document: Document): HTMLElement {
  const scrollingElement = document.scrollingElement as HTMLElement | null;
  const candidates = [
    scrollingElement,
    ...document.querySelectorAll<HTMLElement>("main, [role='main'], [class*='chat' i], [class*='conversation' i], body > div")
  ].filter((element): element is HTMLElement => Boolean(element));

  return candidates
    .map((element) => ({
      element,
      score: scrollScore(element)
    }))
    .sort((a, b) => b.score - a.score)[0]?.element ?? document.documentElement;
}

function scrollScore(element: HTMLElement): number {
  const overflow = getComputedStyle(element).overflowY;
  const canScroll = element.scrollHeight > element.clientHeight + 80;
  const textLength = element.textContent?.length ?? 0;
  return (canScroll ? 1000 : 0) + (/(auto|scroll)/.test(overflow) ? 300 : 0) + Math.min(textLength / 1000, 100);
}

function scrollAndWait(element: HTMLElement, top: number, delay = SCROLL_SETTLE_MS): Promise<void> {
  element.scrollTo({ top, behavior: "instant" });
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

function mergeSnapshots(snapshots: ConversationExport[]): ConversationExport {
  const base = snapshots.at(-1) ?? snapshots[0];
  if (!base) {
    throw new Error("No conversation snapshots captured.");
  }

  const seen = new Set<string>();
  const messages: ChatMessage[] = [];

  for (const snapshot of snapshots) {
    for (const message of snapshot.messages) {
      const key = message.metadata.visibleTextHash ? `${message.role}:${message.metadata.visibleTextHash}` : `${message.role}:${plainKey(message)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      messages.push({ ...message, metadata: { ...message.metadata, index: messages.length } });
    }
  }

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

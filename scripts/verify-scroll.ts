// Diagnostic, not shipped. Build with `npm run probe:build`, then paste dist/verify-scroll.js into the
// DevTools console of a long chat. Runs the real scroll capture + adapter and prints a completeness report.
// Companion: scripts/probe-scroll.js records raw pagination/virtualisation behaviour without our code.
import { extractWithScrollCapture } from "../src/content/scroll-capture";
import { selectAdapter } from "../src/adapters";

const w = window as unknown as { chrome?: { runtime?: Record<string, unknown> }; copy?: (text: string) => void };
w.chrome = w.chrome ?? {};
w.chrome.runtime = w.chrome.runtime ?? {};
w.chrome.runtime.getManifest = () => ({ version: "verify" });

(async () => {
  const adapter = selectAdapter(new URL(location.href), document);
  const startRoots = (adapter.messageElements?.(document) ?? []).length;
  let extracts = 0;
  const original = adapter.extract;
  adapter.extract = function (...args) {
    extracts += 1;
    return original.apply(this, args);
  };

  const t0 = performance.now();
  const conversation = await extractWithScrollCapture(adapter, document);
  const ms = Math.round(performance.now() - t0);

  const messages = conversation.messages.filter((m) => m.kind !== "activity");
  const ids = messages.map((m) => m.metadata.providerMessageId);
  const numeric = ids.every((id) => id !== undefined && /^\d+$/.test(id)) ? ids.map(Number) : null;
  const sorted = numeric ? [...numeric].sort((a, b) => a - b) : null;
  const text = (m: (typeof messages)[number] | undefined) => {
    const block = m?.content[0];
    return block && "text" in block ? block.text.slice(0, 50) : undefined;
  };

  const report = {
    adapter: adapter.id,
    ms,
    extracts,
    startRoots,
    messages: messages.length,
    activity: conversation.messages.length - messages.length,
    withProviderId: ids.filter(Boolean).length,
    dupes: ids.length - new Set(ids).size,
    emptyContent: messages.filter((m) => !m.content.length).length,
    roles: {
      user: messages.filter((m) => m.role === "user").length,
      assistant: messages.filter((m) => m.role === "assistant").length
    },
    numericIndex: numeric && {
      min: sorted![0],
      max: sorted!.at(-1),
      contiguous: sorted!.every((v, i) => i === 0 || v === sorted![i - 1] + 1),
      strictlyIncreasing: numeric.every((v, i) => i === 0 || v > numeric[i - 1])
    },
    first: text(messages[0]),
    last: text(messages.at(-1)),
    model: conversation.source.model
  };

  console.log("VERIFY DONE");
  console.log(JSON.stringify(report));
  if (typeof w.copy === "function") w.copy(JSON.stringify(report));
})();

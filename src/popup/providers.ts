// Labels only; keep in sync with the adapters' host matches. Kept separate so the popup bundle stays small.
const PROVIDER_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)chatgpt\.com$/, "ChatGPT"],
  [/(^|\.)claude\.ai$/, "Claude"],
  [/(^|\.)gemini\.google\.com$/, "Gemini"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
  [/(^|\.)copilot\.microsoft\.com$/, "Copilot"],
  [/(^|\.)bing\.com$/, "Copilot"],
  [/(^|\.)poe\.com$/, "Poe"],
  [/(^|\.)huggingface\.co$/, "HuggingChat"],
  [/(^|\.)chat\.mistral\.ai$/, "Mistral Le Chat"]
];

export type PageKind = { kind: "provider"; label: string } | { kind: "web" } | { kind: "restricted" } | { kind: "unknown" };

export function describePage(url: string | undefined): PageKind {
  if (!url) return { kind: "unknown" };
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: "unknown" };
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.hostname === "chromewebstore.google.com") return { kind: "restricted" };
  const match = PROVIDER_HOSTS.find(([host]) => host.test(parsed.hostname));
  return match ? { kind: "provider", label: match[1] } : { kind: "web" };
}

export function pageStatus(page: PageKind): { text: string; state: "ready" | "warning" | "error" } {
  switch (page.kind) {
    case "provider":
      return { text: `${page.label} detected. Ready to capture.`, state: "ready" };
    case "web":
      return { text: "No supported chat detected. Generic capture or Select Container may still work.", state: "warning" };
    case "restricted":
      return { text: "Chat Trail can't read this page. Open a chat in a normal tab.", state: "error" };
    case "unknown":
      return { text: "Ready to read the active tab.", state: "ready" };
  }
}

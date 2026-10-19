# Chat Trail — notes for agents and contributors

Local-first browser extension that exports AI chat conversations (Markdown/JSON/HTML/evidence ZIP).

## Commands

- `npm run build` — typecheck + Vite build (popup/background + content script)
- `npm test` / `npm run lint` / `npm run typecheck`
- `npm run probe:build` — builds `dist/verify-scroll.js` (diagnostic, see below)

## Capture flow: always in the visible source tab

Hidden tabs get no scroll events, rAF or IntersectionObserver callbacks, so virtualised chats do not render there
and lazy loading never fires. Every capture therefore runs while the source tab is in front:

- Popup → `START_CAPTURE {action}` to the content script, then the popup closes. `src/content/controller.ts`
  captures with an in-page progress pill (Cancel → `AbortSignal`), then downloads/copies in the page or, for
  `review`, keeps the result in memory under a capture id and sends `OPEN_REVIEW {captureId}` to the background.
- Review page → `GET_CAPTURE_RESULT {captureId}` from the source tab. Refresh activates the source tab, sends
  `RUN_CAPTURE`, then switches back (`src/review/source-capture.ts`).
- `chrome.storage.session` holds only `{sourceTabId, captureId}`; results (image data URLs) stay in page memory.
- Re-injection is guarded (`src/content/guard.ts`); do not register listeners outside `claimContentScript()`.

## Scroll capture: why it exists and what each provider does

`src/content/scroll-capture.ts` runs for every adapter. It finds the scroll container as the nearest scrollable
ancestor of the first message element, pages to the top until nothing more loads, then walks down and merges
overlapping snapshots by `metadata.providerMessageId` (fallback: text hash). Adapters expose `messageElements()`
and set `providerMessageId`; without them the generic selector and text-hash keys are used.

Verified live on 2026-08-25 — re-verify when a provider changes its DOM:

| Provider | Loads older on top? | Virtualises? | Stable id |
|---|---|---|---|
| ChatGPT | yes, `…/messages?before=<id>&num_turns=10`, ~0.6 s | yes (12–28 of N turns mounted) | `[data-message-author-role][data-message-id]`; `conversation-turn-N` is renumbered on prepend — never key on it |
| Gemini | yes, `batchexecute rpcids=hNvQHb`, **>1 s** (hence `LOAD_CONFIRM_WAIT_MS`) | no | `.conversation-container[id]` + role |
| Claude | no (whole thread loaded) | yes, hard (9–21 of 256 rows) | `[data-testid='transcript-row'][data-index]` |

The first two columns are encoded per adapter as `scroll: { loadsOlderOnTop, virtualised }`: no load phase when
the provider does not paginate (Claude), a single extraction instead of the walk when it does not virtualise
(Gemini). Adapters without `scroll` (unknown pages, the other hosted providers) get both phases. Change a flag only
after re-verifying the provider; a wrong `false` silently drops messages.

The walk budget follows the thread height (`ceil(scrollHeight / stride) * 2 + 20`, hard cap 3000) and stops early
after 3 steps in which scrolling moved nothing; both end as `walk-limit`. Within one capture each image src is
converted to a data URL once (`beginImageCache`/`endImageCache` in `src/normalizer/dom.ts`).

A single ChatGPT turn can contain several message nodes (e.g. model `bidi`) — extract all of them.

## Re-verifying against a real page

Neither script ships with the extension; both are pasted into DevTools on a long, freshly opened chat:

1. `scripts/probe-scroll.js` — records raw behaviour (scroller, network on scroll-to-top, DOM growth,
   virtualisation window, id attributes) without our code. Use this first when something looks off.
2. `npm run probe:build` → paste `dist/verify-scroll.js` — runs the real `extractWithScrollCapture` with the
   host's adapter and prints a completeness report (count, dupes, empty content, contiguous numeric ids).

Embedded/automation browsers usually cannot log into claude.ai; use the user's own Chrome (extension installed)
for Claude. Long runs (30 s+) exceed typical `evaluate` timeouts — run detached and poll a `window.*` result.

For ChatGPT the backend chain is a usable ground truth: `GET /backend-api/conversation/<id>` with the bearer
token from `/api/auth/session`, walk `mapping` from `current_node` via `parent`.

## Conventions

- Keep code comments short; record only what is not obvious or what someone would otherwise break.
- Fixtures must not contain real chat content — anonymise text, keep structure/attributes.

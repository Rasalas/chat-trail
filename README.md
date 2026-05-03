# Chat Trail

Local-first Chromium extension for exporting AI-chat-like pages. It uses provider adapters for known services and a generic extractor for unknown chat UIs.

## Features

- ChatGPT, Claude, and generic web-chat extraction
- Markdown, JSON, and HTML exports
- Evidence ZIP with transcript files, manifest, hashes, visible screenshot, and HTML snapshot
- Review UI for deselecting messages and redacting visible sensitive data
- No server, no API keys, no provider API calls, and no session-token extraction

## Development

```bash
npm install
npm run build
```

Load `dist/chrome/` as an unpacked extension in Chrome or another Chromium browser.

## Install Without Chrome Web Store

You can test Chat Trail from a release ZIP or from a local build.

### From a release ZIP

1. Download `chat-trail-chrome-v<version>.zip` from the GitHub release.
2. Unzip it somewhere stable, for example `~/Extensions/chat-trail`.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the unzipped folder that directly contains `manifest.json`.

Chrome cannot install this ZIP directly from disk. For manual testing, it must be unzipped and loaded as an unpacked extension.

### From a local build

```bash
npm install
make build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select `dist/chrome/`.

For extension development with rebuild-on-change:

```bash
make install
make dev
```

Keep `dist/chrome/` loaded as the unpacked extension. Chrome may still require pressing the extension reload button after a rebuild, especially for manifest, content-script, and service-worker changes.

## Releases

Create a local Chrome extension ZIP:

```bash
make release-local
```

This writes `releases/chat-trail-chrome-v<version>.zip`.

Create a tagged release:

```bash
make release
git push && git push origin v<version>
```

`make release` suggests `major`, `minor`, or `patch` from Conventional Commits since the last tag, updates `package.json`, `package-lock.json`, and `public/manifest.json`, then creates a release commit and tag. Pushing the tag triggers the GitHub release workflow.

## Current Provider Coverage

- Dedicated adapters: ChatGPT, Claude
- Host-aware generic adapters: Gemini, Perplexity, Copilot, Poe, HuggingChat, Mistral Le Chat
- Fallbacks: generic DOM heuristics, manual container selection, clipboard import

## Architecture

- `src/content`: DOM extraction and page-side manual selection
- `src/adapters`: provider-specific and generic extractors
- `src/normalizer`: DOM-to-neutral-message helpers
- `src/exporters`: Markdown, JSON, HTML, and evidence ZIP generation
- `src/popup`: quick export UI
- `src/review`: preview, filtering, redaction, and evidence export UI

## Privacy Model

Chat Trail runs locally in the browser. It exports only the currently open page at user request. It does not call private provider APIs, crawl accounts, sync to a server, or read cookies/session tokens.

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

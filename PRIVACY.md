# Privacy Policy

Chat Trail is a local-first browser extension for exporting AI chat conversations from the current browser tab.

## Data Collection

Chat Trail does not collect, sell, share, or transmit personal data to any external server controlled by Chat Trail.

When you initiate an export, Chat Trail reads content from the currently active tab in your browser. This can include visible chat messages, visible links, visible images, the page title, the page URL, and optional evidence metadata such as export time, a screenshot, and an HTML snapshot.

This website content is used only to provide the export feature you requested. Chat Trail does not use this content for analytics, advertising, profiling, model training, resale, or any purpose unrelated to creating the local export.

## Local Processing

All extraction and export processing happens locally in your browser. Exports are downloaded to your device as files such as Markdown, JSON, HTML, or ZIP evidence packs.

Chat Trail does not run a backend service for receiving, storing, or processing your exported chat content.

## Optional Clipboard Use

The default extraction mode reads the page DOM. In the review workflow, you may optionally enable provider copy-button extraction. When enabled, Chat Trail may briefly click a provider's message-level copy button, read the clipboard, and attempt to restore the previous clipboard contents. This option is off by default.

## Permissions

Chat Trail requests broad host access so it can work on different AI-chat-like websites and generic web chat pages. It uses the active tab at your request, injects content scripts when needed, stores temporary review state locally, and downloads export files locally.

## Remote Services

Chat Trail does not use private provider APIs, does not require API keys, does not crawl your account, and does not sync exports to a server.

## Contact

For issues or questions, use the GitHub issue tracker:

https://github.com/Rasalas/chat-trail/issues

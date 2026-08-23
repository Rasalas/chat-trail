export type ProviderId =
  | "chatgpt"
  | "claude"
  | "gemini"
  | "perplexity"
  | "copilot"
  | "poe"
  | "huggingchat"
  | "mistral"
  | "generic"
  | "clipboard";

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "code"; language?: string; text: string }
  | { type: "table"; markdown: string }
  | { type: "quote"; text: string; url?: string }
  | { type: "image"; alt?: string; src?: string; filename?: string; data_url?: string; mime_type?: string };

export interface SourceMetadata {
  provider: ProviderId;
  url: string;
  title: string;
  captured_at: string;
  model?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "unknown";
  content: ContentBlock[];
  metadata: {
    timestamp?: string;
    model?: string;
    selector?: string;
    index?: number;
    visibleTextHash?: string;
    extractionMethod?: "dom" | "provider-copy";
    kind?: "activity";
  };
}

export interface Artifact {
  id: string;
  type: "html_snapshot" | "screenshot" | "attachment" | "source" | "image";
  filename: string;
  mime_type: string;
  bytes?: number;
  sha256?: string;
}

export interface ManifestMetadata {
  extension_version: string;
  hashes: Record<string, string>;
  browser?: string;
  platform?: string;
  exported_formats?: string[];
}

export interface ConversationExport {
  schema_version: "1.0";
  source: SourceMetadata;
  messages: ChatMessage[];
  artifacts: Artifact[];
  manifest: ManifestMetadata;
}

export interface AdapterCapabilities {
  modelName: boolean;
  timestamps: boolean;
  citations: boolean;
  artifacts: boolean;
  attachments: boolean;
}

export interface ChatAdapter {
  id: ProviderId;
  label: string;
  matches(url: URL, document: Document): boolean;
  extract(document: Document): Promise<ConversationExport>;
  capabilities: AdapterCapabilities;
}

export interface ExportOptions {
  includeImages: boolean;
  includeMetadata: boolean;
  collapseIntermediate: boolean;
  anonymizeUrl: boolean;
  redactSecrets: boolean;
  useProviderCopy: boolean;
}

export interface ExtractionResult {
  ok: true;
  conversation: ConversationExport;
  adapterId: ProviderId;
  adapterLabel: string;
}

export interface ExtractionFailure {
  ok: false;
  error: string;
}

export type RuntimeResponse = ExtractionResult | ExtractionFailure;

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  includeImages: true,
  includeMetadata: true,
  collapseIntermediate: true,
  anonymizeUrl: false,
  redactSecrets: true,
  useProviderCopy: false
};

import { ChatAdapter } from "../shared/types";
import { chatGptAdapter } from "./chatgpt";
import { claudeAdapter } from "./claude";
import { genericAdapter } from "./generic";
import { hostedGenericAdapters } from "./hosted-generic";

export const adapters: ChatAdapter[] = [chatGptAdapter, claudeAdapter, ...hostedGenericAdapters, genericAdapter];

export function selectAdapter(url: URL, document: Document): ChatAdapter {
  return adapters.find((adapter) => adapter.matches(url, document)) ?? genericAdapter;
}

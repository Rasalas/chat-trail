import { ConversationExport } from "../shared/types";

export function exportJson(conversation: ConversationExport): string {
  return JSON.stringify(conversation, null, 2);
}

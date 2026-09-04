import { ConversationExport } from "./types";

export function captureWarning(conversation: ConversationExport): string | undefined {
  if (conversation.capture?.status !== "incomplete") return undefined;
  const reasons = conversation.capture.reasons.map((reason) =>
    reason === "load-limit" ? "the older-message loading limit was reached" : "the scrolling limit was reached"
  );
  return `Incomplete capture: ${reasons.join("; ")}. Messages may be missing.`;
}

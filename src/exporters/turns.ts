import { ChatMessage } from "../shared/types";

export function intermediateAssistantFlags(messages: ChatMessage[]): boolean[] {
  const flags = messages.map(() => false);
  let runStart = -1;
  let runLength = 0;

  const flush = (): void => {
    if (runLength > 1) {
      for (let index = runStart; index < runStart + runLength - 1; index += 1) {
        flags[index] = true;
      }
    }
    runStart = -1;
    runLength = 0;
  };

  messages.forEach((message, index) => {
    if (message.role !== "assistant") {
      flush();
      return;
    }
    if (runLength === 0) runStart = index;
    runLength += 1;
  });
  flush();

  return flags;
}

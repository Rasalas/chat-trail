const MARKER = "__chatTrailContentScript";

interface Marker {
  isAlive(): boolean;
}

/**
 * Re-injection runs the bundle again in the same isolated world; only the first live copy may register listeners.
 * A copy orphaned by an extension reload loses `chrome.runtime.id`, so a fresh injection takes over.
 */
export function claimContentScript(scope: object = globalThis): boolean {
  const slot = scope as Record<string, Marker | undefined>;
  if (slot[MARKER]?.isAlive()) return false;
  const runtime = chrome.runtime;
  slot[MARKER] = {
    isAlive: () => {
      try {
        return Boolean(runtime?.id);
      } catch {
        return false;
      }
    }
  };
  return true;
}

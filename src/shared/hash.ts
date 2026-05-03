export async function sha256Hex(input: string | Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const buffer =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Blob
        ? await input.arrayBuffer()
        : input instanceof Uint8Array
          ? input.slice().buffer
        : input;

  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function stableId(prefix: string, index: number, text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${index + 1}-${(hash >>> 0).toString(36)}`;
}

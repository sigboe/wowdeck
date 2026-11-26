/** Storage keys (content and encoded keys): raw bytes, compared and printed as hex. */

/** Lower-case hex of `bytes`. */
export const hex = (bytes: Uint8Array): string => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("hex");

/** The bytes of a hex string, or null when it is not one. */
export function fromHex(text: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(text)) return null;
  return Uint8Array.from(Buffer.from(text, "hex"));
}

/** Byte order, shorter first on a common prefix. */
export function compareKeys(a: Uint8Array, b: Uint8Array): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

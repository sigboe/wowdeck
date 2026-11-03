/** Project-owned reader for Steam's binary KeyValues shortcuts, without upstream code. */
type Value = string | number | Map<string, Value>;

export interface SteamShortcut {
  appId: number;
  exe: string;
  startDir: string;
}

/** Throws on truncated, unsupported or excessively nested input. Callers isolate each file. */
export function readSteamShortcuts(bytes: Uint8Array): SteamShortcut[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let offset = 0;
  const take = (length: number): number => {
    const start = offset;
    offset += length;
    if (offset > bytes.length) throw new Error("Truncated binary VDF");
    return start;
  };
  const string = (): string => {
    const start = offset;
    while (bytes[take(1)] !== 0) {
      /* NUL-terminated UTF-8 */
    }
    return decoder.decode(bytes.subarray(start, offset - 1));
  };
  const object = (depth: number): Map<string, Value> => {
    if (depth > 32) throw new Error("Binary VDF nesting limit");
    const values = new Map<string, Value>();
    while (true) {
      const type = bytes[take(1)];
      if (type === 8) return values;
      const key = string().toLowerCase();
      switch (type) {
        case 0:
          values.set(key, object(depth + 1));
          break;
        case 1:
          values.set(key, string());
          break;
        case 2:
          values.set(key, view.getUint32(take(4), true));
          break;
        // Float, pointer and color values are irrelevant to discovery.
        case 3:
        case 4:
        case 6:
          take(4);
          break;
        case 7:
        case 10:
          take(8);
          break;
        case 5:
          while (view.getUint16(take(2), true) !== 0) {
            /* UTF-16 string */
          }
          break;
        default:
          throw new Error("Unsupported binary VDF type");
      }
    }
  };
  const root = object(0);
  if (offset !== bytes.length) throw new Error("Trailing binary VDF data");
  const shortcuts = root.get("shortcuts");
  if (!(shortcuts instanceof Map)) return [];
  const result: SteamShortcut[] = [];
  for (const entry of shortcuts.values()) {
    if (!(entry instanceof Map)) continue;
    const appId = entry.get("appid");
    if (typeof appId !== "number") continue;
    const exe = entry.get("exe");
    const startDir = entry.get("startdir");
    result.push({
      appId,
      exe: typeof exe === "string" ? exe : "",
      startDir: typeof startDir === "string" ? startDir : "",
    });
  }
  return result;
}

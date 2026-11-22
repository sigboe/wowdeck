/**
 * Battle.net's own list of installed games in a Wine prefix (project-owned).
 *
 * The Agent keeps it in `drive_c/ProgramData/Battle.net/Agent/product.db`, a
 * protobuf message. Only the fields read here are decoded; their numbers were
 * checked against Battle.net 2.53.8 on Steam Deck and Linux (2026-11-19):
 *
 *   Database        1: ProductInstall (repeated)
 *   ProductInstall  1: uid ("wow_classic_era")   3: UserSettings
 *   UserSettings    1: install path ("Z:/home/deck/Applications/World of Warcraft")
 *                  13: game subfolder ("_classic_era_")
 *
 * Paths and file contents are personal data: never log them.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";

export interface BattleNetInstall {
  uid: string;
  /** The client folder, canonical. */
  path: string;
}

export interface ProductDbInstall {
  uid: string;
  installPath: string;
  subfolder: string;
}

/** Far above a real product.db (a few KiB); guards against reading junk. */
const MAX_BYTES = 4 * 1024 * 1024;

const PRODUCT_DB = "drive_c/ProgramData/Battle.net/Agent/product.db";

/**
 * The game clients Battle.net has installed in this prefix. Null when the
 * prefix has no readable product.db; an empty list when it lists no client.
 */
export async function battleNetInstalls(prefix: string): Promise<BattleNetInstall[] | null> {
  let installs: ProductDbInstall[];
  try {
    const file = join(prefix, PRODUCT_DB);
    if ((await stat(file)).size > MAX_BYTES) return null;
    installs = parseProductDb(await readFile(file));
  } catch {
    return null;
  }
  const resolved = await Promise.all(installs.map(async ({ uid, installPath, subfolder }) => {
    // A subfolder is one folder name; Battle.net never writes a path there.
    if (!subfolder || /[\\/]/.test(subfolder) || subfolder === "." || subfolder === "..") return;
    const root = windowsPath(prefix, installPath);
    const path = root && await realpath(join(root, subfolder)).catch(() => undefined);
    return path ? { uid, path } : undefined;
  }));
  return resolved.filter((install) => install !== undefined);
}

/** A drive-letter path through the prefix's own dosdevices links. */
function windowsPath(prefix: string, path: string): string | undefined {
  const match = /^([a-z]):(?:[\\/](.*))?$/i.exec(path);
  if (!match) return;
  const rest = (match[2] ?? "").replaceAll("\\", "/");
  return join(prefix, "dosdevices", `${match[1]!.toLowerCase()}:`, rest);
}

/** Throws on malformed input. */
export function parseProductDb(bytes: Uint8Array): ProductDbInstall[] {
  const installs: ProductDbInstall[] = [];
  for (const field of fields(bytes)) {
    if (field.number !== 1 || !field.bytes) continue;
    let uid = "";
    let installPath = "";
    let subfolder = "";
    for (const install of fields(field.bytes)) {
      if (install.number === 1 && install.bytes) uid = text(install.bytes);
      if (install.number !== 3 || !install.bytes) continue;
      for (const setting of fields(install.bytes)) {
        if (setting.number === 1 && setting.bytes) installPath = text(setting.bytes);
        if (setting.number === 13 && setting.bytes) subfolder = text(setting.bytes);
      }
    }
    if (uid) installs.push({ uid, installPath, subfolder });
  }
  return installs;
}

const decoder = new TextDecoder("utf-8", { fatal: true });
const text = (bytes: Uint8Array) => decoder.decode(bytes);

interface Field {
  number: number;
  /** Set for length-delimited fields only. */
  bytes?: Uint8Array;
}

function* fields(bytes: Uint8Array): Generator<Field> {
  let offset = 0;
  const varint = (): number => {
    let value = 0;
    for (let shift = 1; ; shift *= 128) {
      if (offset >= bytes.length || shift > 2 ** 63) throw new Error("Truncated protobuf varint");
      const byte = bytes[offset++]!;
      value += (byte & 0x7f) * shift;
      if (byte < 0x80) return value;
    }
  };
  const skip = (length: number) => {
    if (length > bytes.length - offset) throw new Error("Truncated protobuf field");
    offset += length;
  };
  while (offset < bytes.length) {
    const key = varint();
    const number = Math.floor(key / 8);
    switch (key % 8) {
      case 0:
        varint();
        yield { number };
        break;
      case 1:
        skip(8);
        yield { number };
        break;
      case 2: {
        const length = varint();
        const start = offset;
        skip(length);
        yield { number, bytes: bytes.subarray(start, offset) };
        break;
      }
      case 5:
        skip(4);
        yield { number };
        break;
      default:
        throw new Error("Unsupported protobuf wire type");
    }
  }
}

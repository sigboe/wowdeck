/**
 * A Battle.net Agent product.db, encoded the way Battle.net writes it
 * (the fields BattleNetInstalls.ts reads, plus a few it skips).
 */
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ProductDbEntry {
  uid: string;
  installPath: string;
  subfolder: string;
}

const varint = (value: number): number[] => {
  const out: number[] = [];
  while (value >= 0x80) {
    out.push((value & 0x7f) | 0x80);
    value = Math.floor(value / 128);
  }
  return [...out, value];
};
const field = (number: number, value: string | Uint8Array): Uint8Array => {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return new Uint8Array([...varint(number * 8 + 2), ...varint(bytes.length), ...bytes]);
};
const varintField = (number: number, value: number) => new Uint8Array([...varint(number * 8), ...varint(value)]);
const concat = (...parts: Uint8Array[]) => new Uint8Array(parts.flatMap((part) => [...part]));

export function productDb(installs: ProductDbEntry[]): Uint8Array {
  return concat(
    // Battle.net's own entries carry no subfolder.
    field(1, concat(field(1, "battle.net"), field(2, "bna"), field(3, field(1, "C:/Program Files (x86)/Battle.net")))),
    ...installs.map(({ uid, installPath, subfolder }) => field(1, concat(
      field(1, uid),
      field(2, uid),
      field(3, concat(field(1, installPath), field(2, "EU"), varintField(3, 2), field(13, subfolder))),
      field(4, field(1, "state")),
      field(6, "wow"),
    ))),
    varintField(6, 4148300),
  );
}

export const PRODUCT_DB = "drive_c/ProgramData/Battle.net/Agent/product.db";

/** Gives a prefix Wine's Z: drive and a product.db listing these installs. */
export function writeProductDb(prefix: string, installs: ProductDbEntry[]): void {
  mkdirSync(join(prefix, "dosdevices"), { recursive: true });
  try {
    symlinkSync("/", join(prefix, "dosdevices/z:"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  mkdirSync(join(prefix, "drive_c/ProgramData/Battle.net/Agent"), { recursive: true });
  writeFileSync(join(prefix, PRODUCT_DB), productDb(installs));
}

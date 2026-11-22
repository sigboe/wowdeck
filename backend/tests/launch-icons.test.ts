import { describe, expect, test } from "bun:test";
import {
  ExecutableIconCache,
  iconDataUrl,
  readExecutableIcon,
} from "../src/wow/launch/ExecutableIcon";
import { BMP, PNG, RESOURCE_FILE_OFFSET, syntheticPe } from "./helpers/syntheticPe";

function entryAt(ico: Uint8Array, index: number) {
  const at = 6 + index * 16;
  return {
    width: ico[at],
    height: ico[at + 1],
    planes: ico[at + 4] | (ico[at + 5] << 8),
    bits: ico[at + 6] | (ico[at + 7] << 8),
    size: (ico[at + 8] | (ico[at + 9] << 8) | (ico[at + 10] << 16) | (ico[at + 11] << 24)) >>> 0,
    offset:
      (ico[at + 12] | (ico[at + 13] << 8) | (ico[at + 14] << 16) | (ico[at + 15] << 24)) >>> 0,
  };
}

describe("reading a PE's icon", () => {
  test("one BMP group entry becomes one ICO entry with the payload after it", () => {
    const ico = readExecutableIcon(syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]));
    expect(ico).toBeDefined();
    if (!ico) return;
    expect(ico[0] | (ico[1] << 8)).toBe(0);
    expect(ico[2] | (ico[3] << 8)).toBe(1);
    expect(ico[4] | (ico[5] << 8)).toBe(1);
    const entry = entryAt(ico, 0);
    expect(entry).toMatchObject({
      width: 16,
      height: 16,
      planes: 1,
      bits: 32,
      size: BMP.length,
      offset: 22,
    });
    expect([...ico.subarray(entry.offset, entry.offset + BMP.length)]).toEqual([...BMP]);
    expect(ico.length).toBe(22 + BMP.length);
  });

  test("of several sizes, only the smallest of at least 48 px is kept", () => {
    const ico = readExecutableIcon(
      syntheticPe([
        { id: 1, width: 16, height: 16, payload: BMP },
        { id: 2, width: 0, height: 0, payload: PNG },
        { id: 3, width: 64, height: 64, payload: BMP },
        { id: 4, width: 48, height: 48, payload: PNG },
        { id: 5, width: 32, height: 32, payload: BMP },
      ]),
    );
    expect(ico).toBeDefined();
    if (!ico) return;
    expect(ico[4] | (ico[5] << 8)).toBe(1);
    expect(entryAt(ico, 0)).toMatchObject({ width: 48, size: PNG.length, offset: 22 });
    expect([...ico.subarray(22)]).toEqual([...PNG]);
  });

  test("without an image of 48 px, the largest is kept", () => {
    const ico = readExecutableIcon(
      syntheticPe([
        { id: 1, width: 16, height: 16, payload: BMP },
        { id: 2, width: 32, height: 32, payload: PNG },
        { id: 3, width: 24, height: 24, payload: BMP },
      ]),
    );
    expect(ico && entryAt(ico, 0)).toMatchObject({ width: 32, size: PNG.length });
  });

  test("of two images the same size, the deeper colour is kept", () => {
    const ico = readExecutableIcon(
      syntheticPe([
        { id: 1, width: 48, height: 48, payload: BMP, bits: 8 },
        { id: 2, width: 48, height: 48, payload: PNG, bits: 32 },
        { id: 3, width: 48, height: 48, payload: BMP, bits: 4 },
      ]),
    );
    expect(ico && entryAt(ico, 0)).toMatchObject({ width: 48, bits: 32, size: PNG.length });
  });

  test("an image the group names but lacks spoils the icon even when another is kept", () => {
    const pe = syntheticPe([
      { id: 1, width: 48, height: 48, payload: BMP },
      { id: 2, width: 16, height: 16, payload: new Uint8Array(40).fill(7) },
    ]);
    expect(readExecutableIcon(pe)).toBeUndefined();
  });

  test("a PNG image is carried through untouched", () => {
    const ico = readExecutableIcon(
      syntheticPe([{ id: 4, width: 0, height: 0, payload: PNG }], true),
    );
    expect(ico).toBeDefined();
    if (!ico) return;
    const entry = entryAt(ico, 0);
    expect(entry.width).toBe(0);
    expect(entry.height).toBe(0);
    expect([...ico.subarray(entry.offset, entry.offset + PNG.length)]).toEqual([...PNG]);
  });

  test("a well-formed resource tree with a bogus image returns nothing", () => {
    expect(
      readExecutableIcon(
        syntheticPe([{ id: 1, width: 16, height: 16, payload: new Uint8Array(40).fill(7) }]),
      ),
    ).toBeUndefined();
  });

  test("input with no icon group is not an icon", () => {
    const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
    // Drop the RT_GROUP_ICON entry from the type directory.
    pe.set([0, 0, 0, 0], RESOURCE_FILE_OFFSET + 24);
    expect(readExecutableIcon(pe)).toBeUndefined();
  });

  test("a group that names an image the file does not contain returns nothing", () => {
    const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
    // Point the group's only entry at icon id 9, which has no RT_ICON.
    // One icon puts the group blob at resource offset 160 (see syntheticPe).
    const groupEntryId = RESOURCE_FILE_OFFSET + 160 + 6 + 12;
    expect(pe[groupEntryId]).toBe(1);
    pe[groupEntryId] = 9;
    expect(readExecutableIcon(pe)).toBeUndefined();
  });

  test("truncated and nonsensical input returns nothing", () => {
    expect(readExecutableIcon(new Uint8Array(0))).toBeUndefined();
    expect(readExecutableIcon(new TextEncoder().encode("MZ"))).toBeUndefined();
    const pe = syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
    expect(readExecutableIcon(pe.subarray(0, 0x50))).toBeUndefined();
    expect(readExecutableIcon(pe.subarray(0, RESOURCE_FILE_OFFSET))).toBeUndefined();
    const wrongSignature = pe.slice();
    wrongSignature[0x40] = 0;
    expect(readExecutableIcon(wrongSignature)).toBeUndefined();
    const noResources = pe.slice();
    noResources.fill(0, 0x40 + 24 + 96 + 16, 0x40 + 24 + 96 + 24);
    expect(readExecutableIcon(noResources)).toBeUndefined();
  });
});

describe("the executable icon cache", () => {
  test("same path, size and mtime reads once; a change reads again", async () => {
    let stats = { size: 100, mtimeMs: 1 };
    const reads: string[] = [];
    const cache = new ExecutableIconCache(
      () => stats,
      (path) => {
        reads.push(path);
        return syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]);
      },
    );
    expect(await cache.icon("Wow.exe")).toBeDefined();
    expect(await cache.icon("Wow.exe")).toBeDefined();
    expect(reads).toEqual(["Wow.exe"]);
    stats = { size: 100, mtimeMs: 2 };
    expect(await cache.icon("Wow.exe")).toBeDefined();
    stats = { size: 101, mtimeMs: 2 };
    expect(await cache.icon("Wow.exe")).toBeDefined();
    expect(await cache.icon("WowClassic.exe")).toBeDefined();
    expect(reads).toEqual(["Wow.exe", "Wow.exe", "Wow.exe", "WowClassic.exe"]);
  });

  test("a missing file and an unreadable file both answer nothing", async () => {
    const missing = new ExecutableIconCache(
      () => undefined,
      () => syntheticPe([]),
    );
    expect(await missing.icon("gone.exe")).toBeUndefined();
    const unreadable = new ExecutableIconCache(
      () => ({ size: 1, mtimeMs: 1 }),
      () => undefined,
    );
    expect(await unreadable.icon("locked.exe")).toBeUndefined();
  });

  test("a failed read is retried; an executable without an icon is not re-read", async () => {
    // chmod changes neither size nor mtime, so the file looks the same when it is readable again.
    let readable = false;
    const reads: string[] = [];
    const cache = new ExecutableIconCache(
      () => ({ size: 100, mtimeMs: 1 }),
      (path) => {
        reads.push(path);
        if (path === "Iconless.exe") return syntheticPe([]);
        return readable ? syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]) : undefined;
      },
    );
    expect(await cache.icon("Wow.exe")).toBeUndefined();
    readable = true;
    expect(await cache.icon("Wow.exe")).toBeDefined();
    expect(await cache.icon("Iconless.exe")).toBeUndefined();
    expect(await cache.icon("Iconless.exe")).toBeUndefined();
    expect(reads).toEqual(["Wow.exe", "Wow.exe", "Iconless.exe"]);
  });

  test("the data URL is an ICO the frontend can put in an img", () => {
    const ico = readExecutableIcon(syntheticPe([{ id: 1, width: 16, height: 16, payload: BMP }]))!;
    const url = iconDataUrl(ico);
    expect(url.startsWith("data:image/x-icon;base64,")).toBe(true);
    expect([...Buffer.from(url.split(",")[1], "base64")]).toEqual([...ico]);
  });
});

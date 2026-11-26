import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { BlteFile } from "../src/wow/casc/Blte";
import { CascStorage, parseBuildConfig } from "../src/wow/casc/CascStorage";
import { decodeBlp } from "../src/wow/textures/Blp";
import { encodePng } from "../src/wow/textures/Png";
import { GameTextures } from "../src/wow/textures/GameTextures";
import type { WowInstallation } from "../src/wow/models";
import { WowClientType } from "../src/wow/types";
import { blp, blte, writeCascFixture } from "./helpers/cascFixture";

const temp = () => mkdtempSync(join(tmpdir(), "casc-"));
const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => new TextEncoder().encode(value);

// BC1 colour blocks: c0 and c1 as RGB565, then 2-bit indices for 16 pixels.
const RED = 0xf800;
const BLUE = 0x001f;
const bc1 = (c0: number, c1: number, indices: number) =>
  bytes(c0 & 0xff, c0 >> 8, c1 & 0xff, c1 >> 8, indices & 0xff, (indices >> 8) & 0xff, (indices >> 16) & 0xff, (indices >>> 24) & 0xff);
/** A content key no file has: the extra root blocks point their IDs at nothing. */
const NO_FILE = new Uint8Array(16).fill(0xee);
const pixel = (rgba: Uint8Array, i: number) => [...rgba.subarray(i * 4, i * 4 + 4)];

test("BLTE reads raw and compressed chunks, also across chunk edges, and refuses encrypted ones", () => {
  const data = text("the quick brown fox jumps over the lazy dog");
  const file = BlteFile.parse(blte(data, "Z", 4))!;
  expect(file.size).toBe(data.length);
  expect(new TextDecoder().decode(file.read(10, 20)!)).toBe("brown fox jumps over");
  expect(file.all()).toEqual(data);
  expect(BlteFile.parse(blte(data, "N"))!.all()).toEqual(data);
  expect(BlteFile.parse(blte(data, "E"))!.all()).toBeNull();
  // Out of range, not BLTE, and a chunk table running past the data.
  expect(file.read(40, 10)).toBeNull();
  expect(BlteFile.parse(text("NOPE0000"))).toBeNull();
  expect(BlteFile.parse(blte(data, "Z", 2).subarray(0, 40))).toBeNull();
});

test("a build config gives the root's content key and the encoding file's encoded key", () => {
  const config = parseBuildConfig("# Build Configuration\n\nroot = 00ff\nencoding = 0102 a0b1\ninstall = 33\n");
  expect(config).toEqual({ root: bytes(0, 255), encoding: bytes(0xa0, 0xb1) });
  expect(parseBuildConfig("root = 00ff\n")).toBeNull();
});

test("FileDataIDs resolve through root, encoding and the newest index, in one pass for a whole set", async () => {
  const root = temp();
  try {
    const files = [101, 202, 303, 404].map((id) => ({ id, bytes: text(`file ${id}`), mode: id === 303 ? "Z" as const : "N" as const }));
    const { buildKey } = writeCascFixture(root, files, {
      fillerKeys: 200,
      extraRoot: [
        // Another locale and a low-violence copy come first and must lose.
        { locale: 0x20, files: [[101, NO_FILE]] },
        { locale: 0x2, content: 0x80, files: [[202, NO_FILE]] },
      ],
    });
    const storage = (await CascStorage.open(root, buildKey))!;
    const places = await storage.locate([101, 999], () => [202, 303]);
    expect(places.get(101)).not.toBeNull();
    expect(places.get(999)).toBeNull();
    // 202 and 303 came along: their reads need no second pass.
    expect(new TextDecoder().decode((await storage.read(303))!)).toBe("file 303");
    expect(new TextDecoder().decode((await storage.read(202))!)).toBe("file 202");
    expect(new TextDecoder().decode((await storage.read(404))!)).toBe("file 404");
    expect(await storage.read(999)).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing build config or a wrong build key opens no storage", async () => {
  const root = temp();
  try {
    writeCascFixture(root, [{ id: 1, bytes: text("x") }]);
    expect(await CascStorage.open(root, "0".repeat(32))).toBeNull();
    expect(await CascStorage.open(root, "../../etc")).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("DXT1 without alpha is opaque; with 1-bit alpha, index 3 of a three-colour block is transparent", () => {
  // c0 > c1: four colours; every pixel index 0 (red).
  const red = decodeBlp(blp({ encoding: 2, width: 4, height: 4, mips: [bc1(RED, BLUE, 0)] }), 4)!;
  expect(pixel(red.pixels, 0)).toEqual([255, 0, 0, 255]);
  // c0 ≤ c1: three colours plus index 3 (all 0xff… indices).
  const block = bc1(BLUE, RED, 0xffffffff);
  expect(pixel(decodeBlp(blp({ encoding: 2, alphaDepth: 0, width: 4, height: 4, mips: [block] }), 4)!.pixels, 5)).toEqual([0, 0, 0, 255]);
  expect(pixel(decodeBlp(blp({ encoding: 2, alphaDepth: 1, width: 4, height: 4, mips: [block] }), 4)!.pixels, 5)).toEqual([0, 0, 0, 0]);
});

test("DXT3 and DXT5 decode their alpha; DXT5's interpolated steps follow the end points", () => {
  const dxt3 = new Uint8Array(16);
  dxt3.set([0x0f, 0xf0], 0); // pixel 0 alpha 15, pixel 1 alpha 0, pixel 2 0, pixel 3 15
  dxt3.set(bc1(RED, BLUE, 0), 8);
  const three = decodeBlp(blp({ encoding: 2, alphaDepth: 8, alphaType: 1, width: 4, height: 4, mips: [dxt3] }), 4)!;
  expect([0, 1, 2, 3].map((i) => three.pixels[i * 4 + 3])).toEqual([255, 0, 0, 255]);

  const dxt5 = new Uint8Array(16);
  // a0 255, a1 0; pixel 0 index 0 (255), pixel 1 index 1 (0), pixel 2 index 2 (219).
  dxt5.set([255, 0, 0b10_001_000, 0, 0, 0, 0, 0], 0);
  dxt5.set(bc1(RED, BLUE, 0), 8);
  const five = decodeBlp(blp({ encoding: 2, alphaDepth: 8, alphaType: 7, width: 4, height: 4, mips: [dxt5] }), 4)!;
  expect([0, 1, 2].map((i) => five.pixels[i * 4 + 3])).toEqual([255, 0, 219]);
  expect(pixel(five.pixels, 0).slice(0, 3)).toEqual([255, 0, 0]);
});

test("palette and BGRA textures decode, with the palette's alpha plane", () => {
  const palette = new Uint8Array(1024);
  palette.set([10, 20, 30, 0], 4); // entry 1: BGR 10, 20, 30
  const paletted = blp({ encoding: 1, alphaDepth: 8, width: 2, height: 1, mips: [bytes(1, 0, 128, 255)], palette });
  const image = decodeBlp(paletted, 2)!;
  expect(pixel(image.pixels, 0)).toEqual([30, 20, 10, 128]);
  expect(pixel(image.pixels, 1)).toEqual([0, 0, 0, 255]);
  const bgra = decodeBlp(blp({ encoding: 3, width: 1, height: 1, mips: [bytes(1, 2, 3, 4)] }), 1)!;
  expect(pixel(bgra.pixels, 0)).toEqual([3, 2, 1, 4]);
});

test("the smallest mipmap at least as large as asked is decoded, edge blocks clipped", () => {
  const mips = [new Uint8Array(4 * 8), new Uint8Array(8), bc1(RED, BLUE, 0), bc1(RED, BLUE, 0)];
  const texture = blp({ encoding: 2, width: 8, height: 8, mips });
  expect(decodeBlp(texture, 8)).toMatchObject({ width: 8, height: 8 });
  expect(decodeBlp(texture, 5)).toMatchObject({ width: 8, height: 8 });
  expect(decodeBlp(texture, 4)).toMatchObject({ width: 4, height: 4 });
  const two = decodeBlp(texture, 2)!;
  expect(two).toMatchObject({ width: 2, height: 2 });
  expect(two.pixels.length).toBe(16);
  expect(pixel(two.pixels, 3)).toEqual([255, 0, 0, 255]);
});

test("a malformed texture decodes to nothing", () => {
  expect(decodeBlp(text("BLP2"), 4)).toBeNull();
  const good = blp({ encoding: 2, width: 4, height: 4, mips: [bc1(RED, BLUE, 0)] });
  expect(decodeBlp(good.subarray(0, good.length - 1), 4)).toBeNull();
  const huge = good.slice();
  new DataView(huge.buffer).setUint32(12, 100_000, true);
  expect(decodeBlp(huge, 4)).toBeNull();
});

test("PNG output holds the RGBA rows unfiltered", () => {
  const pixels = Uint8Array.from({ length: 2 * 2 * 4 }, (_, i) => i * 7);
  const png = encodePng({ width: 2, height: 2, pixels });
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset);
  expect(new TextDecoder().decode(png.subarray(12, 16))).toBe("IHDR");
  expect([view.getUint32(16), view.getUint32(20), png[24], png[25]]).toEqual([2, 2, 8, 6]);
  const idatLength = view.getUint32(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLength));
  expect([...raw]).toEqual([0, ...pixels.subarray(0, 8), 0, ...pixels.subarray(8)]);
  // Each chunk's CRC covers its type and data.
  expect(view.getUint32(29)).toBe(Bun.hash.crc32(png.subarray(12, 29)));
});

test("GameTextures answers PNG data URLs for the IDs the install has, and none without Battle.net's storage", async () => {
  const root = temp();
  try {
    const icon = blp({ encoding: 2, width: 4, height: 4, mips: [bc1(RED, BLUE, 0)] });
    const { flavorDir } = writeCascFixture(root, [{ id: 133919, bytes: icon, mode: "Z" }, { id: 7, bytes: text("not a texture") }]);
    const installation = { id: "era", location: flavorDir, clientType: WowClientType.ClassicEra } as WowInstallation;
    const textures = new GameTextures();
    const icons = await textures.icons(installation, [133919, 133919, 7, 5], 36);
    expect(Object.keys(icons)).toEqual(["133919"]);
    expect(icons["133919"]).toStartWith("data:image/png;base64,");

    // A copied install: no .build.info.
    rmSync(join(root, ".build.info"));
    expect(await textures.icons(installation, [133919], 36)).toEqual({});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a new build key in .build.info opens the new build", async () => {
  const root = temp();
  try {
    const first = blp({ encoding: 2, width: 4, height: 4, mips: [bc1(RED, BLUE, 0)] });
    const { flavorDir } = writeCascFixture(root, [{ id: 1, bytes: first }]);
    const installation = { id: "era", location: flavorDir, clientType: WowClientType.ClassicEra } as WowInstallation;
    const textures = new GameTextures();
    const before = await textures.icons(installation, [1], 4);
    // The patch rewrites the storage with a different texture under the same ID.
    const patched = blp({ encoding: 2, width: 4, height: 4, mips: [bc1(BLUE, RED, 0)] });
    writeCascFixture(root, [{ id: 1, bytes: patched }]);
    const after = await textures.icons(installation, [1], 4);
    expect(after["1"]).toBeDefined();
    expect(after["1"]).not.toBe(before["1"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("index files of an unknown layout are skipped", async () => {
  const root = temp();
  try {
    const { buildKey } = writeCascFixture(root, [{ id: 1, bytes: text("x") }]);
    const dataDir = join(root, "Data", "data");
    // A newer bucket file with an 8-byte key field: the bucket reads as empty.
    for (let bucket = 0; bucket < 16; bucket++) {
      const header = new Uint8Array(0x28);
      new DataView(header.buffer).setUint32(0, 0x10, true);
      header.set([4, 5, 8, 30], 12);
      writeFileSync(join(dataDir, `${bucket.toString(16).padStart(2, "0")}00000009.idx`), header);
    }
    expect(await CascStorage.open(root, buildKey).then((s) => s!.read(1))).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

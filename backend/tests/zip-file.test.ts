import { describe, expect, test } from "bun:test";
import { deflateSync, zipSync } from "fflate";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { extractArchive } from "../src/wow/archives/ArchiveExtractor";
import { readZipEntries } from "../src/wow/archives/ZipFile";

const TMP = "/tmp/opencode/wowdeck-tests/zip-file";
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

/** Bytes that deflate to about half their size, the same on every run. */
function halfCompressible(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    // xorshift32; only the low four bits vary, so each byte carries half a byte of entropy.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[i] = 0x40 | (state & 0x0f);
  }
  return out;
}

interface RawEntry {
  name: string;
  content: Uint8Array;
  /** The size the headers declare; the content's own by default. */
  declaredSize?: number;
  /** Deflated data to store as is, in place of deflating `content`. */
  deflated?: Uint8Array;
}

interface RawZipOptions {
  /** Sizes follow the data (flag bit 3); the local header holds zeros. */
  dataDescriptor?: boolean;
  /** Sizes and offsets live in zip64 extra fields and a zip64 end record. */
  zip64?: boolean;
  stored?: boolean;
}

/** A zip written by hand, for the layouts fflate's writer never produces. */
function rawZip(entries: RawEntry[], options: RawZipOptions = {}): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const u64 = (value: number): Buffer => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(value));
    return b;
  };
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf-8");
    const data = Buffer.from(entry.deflated ?? (options.stored ? entry.content : deflateSync(entry.content)));
    const size = entry.declaredSize ?? entry.content.length;
    const crc = Bun.hash.crc32(entry.content);
    const flags = 0x800 | (options.dataDescriptor ? 8 : 0);
    const method = options.stored ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(options.zip64 ? 45 : 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    if (!options.dataDescriptor) {
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(options.zip64 ? 0xffffffff : data.length, 18);
      local.writeUInt32LE(options.zip64 ? 0xffffffff : size, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const localExtra = options.zip64 && !options.dataDescriptor
      ? Buffer.concat([Buffer.from([1, 0, 16, 0]), u64(size), u64(data.length)])
      : Buffer.alloc(0);
    local.writeUInt16LE(localExtra.length, 28);
    const descriptor = Buffer.alloc(options.dataDescriptor ? 16 : 0);
    if (options.dataDescriptor) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(data.length, 8);
      descriptor.writeUInt32LE(size, 12);
    }

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(options.zip64 ? 45 : 20, 4);
    header.writeUInt16LE(options.zip64 ? 45 : 20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(options.zip64 ? 0xffffffff : data.length, 20);
    header.writeUInt32LE(options.zip64 ? 0xffffffff : size, 24);
    header.writeUInt16LE(name.length, 28);
    const extra = options.zip64
      ? Buffer.concat([Buffer.from([1, 0, 24, 0]), u64(size), u64(data.length), u64(offset)])
      : Buffer.alloc(0);
    header.writeUInt16LE(extra.length, 30);
    header.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 42);
    central.push(header, name, extra);

    parts.push(local, name, localExtra, data, descriptor);
    offset += local.length + name.length + localExtra.length + data.length + descriptor.length;
  }
  const directory = Buffer.concat(central);
  const tail: Buffer[] = [directory];
  if (options.zip64) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(0x06064b50, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12);
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(entries.length), 24);
    record.writeBigUInt64LE(BigInt(entries.length), 32);
    record.writeBigUInt64LE(BigInt(directory.length), 40);
    record.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
    locator.writeUInt32LE(1, 16);
    tail.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.zip64 ? 0xffff : entries.length, 8);
  end.writeUInt16LE(options.zip64 ? 0xffff : entries.length, 10);
  end.writeUInt32LE(options.zip64 ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 16);
  tail.push(end);
  return Buffer.concat([...parts, ...tail]);
}

function fixture(name: string, bytes: Uint8Array): { zipPath: string; dest: string } {
  const zipPath = join(TMP, `${name}.zip`);
  writeFileSync(zipPath, bytes);
  return { zipPath, dest: join(TMP, name) };
}

const TOC = text("## Title: Foo\n## Version: 1\n");

describe("streaming zip extraction", () => {
  test("large deflated and stored entries come out byte for byte", async () => {
    // Above 320 kB compressed: the size from which fflate's whole-archive unzip starts a worker per entry.
    // The texture is above 1 MiB compressed and streams; the table and the toc inflate in one step.
    const texture = halfCompressible(3_000_000, 1);
    const table = text("Data[1] = { name = 'entry', value = 1 }\n".repeat(60_000));
    const sound = halfCompressible(700_000, 2);
    const { zipPath, dest } = fixture(
      "large",
      zipSync({
        "Foo/Foo.toc": TOC,
        "Foo/media/texture.blp": texture,
        "Foo/data/table.lua": table,
        "Foo/media/sound.ogg": [sound, { level: 0 }],
        "Foo/empty.lua": new Uint8Array(0),
      }),
    );
    const result = await extractArchive(zipPath, dest);
    expect(result.fileCount).toBe(5);
    expect(result.totalBytes).toBe(TOC.length + texture.length + table.length + sound.length);
    expect(readFileSync(join(dest, "Foo/media/texture.blp")).equals(texture)).toBe(true);
    expect(readFileSync(join(dest, "Foo/data/table.lua")).equals(table)).toBe(true);
    expect(readFileSync(join(dest, "Foo/media/sound.ogg")).equals(sound)).toBe(true);
    expect(readFileSync(join(dest, "Foo/empty.lua")).length).toBe(0);
  });

  test("an addon of many large files extracts without holding it in memory", async () => {
    // 40 entries of about 600 kB compressed took more than 2 GiB with one worker per entry.
    const files: Record<string, Uint8Array> = { "Foo/Foo.toc": TOC };
    for (let i = 0; i < 40; i++) {
      files[`Foo/media/texture${i}.blp`] = halfCompressible(1_200_000, i + 1);
    }
    const { zipPath, dest } = fixture("many-large", zipSync(files));
    const before = process.resourceUsage().maxRSS;
    const result = await extractArchive(zipPath, dest);
    const grownMiB = (process.resourceUsage().maxRSS - before) / 1024;
    expect(result.fileCount).toBe(41);
    expect(result.totalBytes).toBe(TOC.length + 40 * 1_200_000);
    expect(readFileSync(join(dest, "Foo/media/texture39.blp")).equals(halfCompressible(1_200_000, 40))).toBe(true);
    expect(grownMiB).toBeLessThan(256);
  });

  for (const stored of [false, true]) {
    test(`entries with a data descriptor read their sizes from the central directory (${stored ? "stored" : "deflated"})`, async () => {
      const lua = text("print('hello')\n".repeat(2000));
      const { zipPath, dest } = fixture(
        `descriptor-${stored}`,
        rawZip([{ name: "Foo/Foo.toc", content: TOC }, { name: "Foo/Foo.lua", content: lua }], { dataDescriptor: true, stored }),
      );
      const result = await extractArchive(zipPath, dest);
      expect(result.topLevelDirs).toEqual(["Foo"]);
      expect(readFileSync(join(dest, "Foo/Foo.lua")).equals(lua)).toBe(true);
    });
  }

  test("a zip64 archive extracts", async () => {
    const lua = text("print('hello')\n".repeat(2000));
    const { zipPath, dest } = fixture(
      "zip64",
      rawZip([{ name: "Foo/Foo.toc", content: TOC }, { name: "Foo/Foo.lua", content: lua }], { zip64: true }),
    );
    const fh = await open(zipPath, "r");
    try {
      expect((await readZipEntries(fh)).map((e) => [e.name, e.uncompressedSize])).toEqual([
        ["Foo/Foo.toc", TOC.length],
        ["Foo/Foo.lua", lua.length],
      ]);
    } finally {
      await fh.close();
    }
    await extractArchive(zipPath, dest);
    expect(readFileSync(join(dest, "Foo/Foo.lua")).equals(lua)).toBe(true);
  });

  test("a later entry of the same name replaces the earlier one", async () => {
    const { zipPath, dest } = fixture(
      "duplicate",
      rawZip([
        { name: "Foo/Foo.toc", content: text("## Title: Old\n".repeat(50)) },
        { name: "Foo/Foo.toc", content: TOC },
      ]),
    );
    await extractArchive(zipPath, dest);
    expect(readFileSync(join(dest, "Foo/Foo.toc")).equals(TOC)).toBe(true);
  });

  test("a small entry that inflates past its declared size is damaged, and is not written", async () => {
    const bomb = text("a".repeat(5_000_000));
    const { zipPath, dest } = fixture(
      "larger-than-declared",
      rawZip([{ name: "Foo/Foo.toc", content: TOC }, { name: "Foo/bomb.lua", content: bomb, declaredSize: 100 }]),
    );
    await expect(extractArchive(zipPath, dest)).rejects.toThrow(/damaged/);
    expect(existsSync(join(dest, "Foo/bomb.lua"))).toBe(false);
  });

  // 128 MiB of zeros deflate to about 130 kB: small enough to inflate in one step. Built here, outside the test's time.
  const smallBomb = deflateRawSync(new Uint8Array(128 * 1024 * 1024), { level: 9 });

  test(
    "a small entry that would inflate to far more than declared stops at the declared size",
    async () => {
      // A decoder that keeps inflating after the declared size takes seconds here; one that stops takes a millisecond.
      const { zipPath, dest } = fixture(
        "small-bomb",
        rawZip([
          { name: "Foo/Foo.toc", content: TOC },
          { name: "Foo/bomb.lua", content: new Uint8Array(0), deflated: smallBomb, declaredSize: 100 },
        ]),
      );
      await expect(extractArchive(zipPath, dest)).rejects.toThrow(/damaged/);
      expect(existsSync(join(dest, "Foo/bomb.lua"))).toBe(false);
    },
    { timeout: 2000 },
  );

  test("a large entry that inflates past its declared size is damaged, and stops there", async () => {
    // More than 1 MiB compressed, so it streams.
    const { zipPath, dest } = fixture(
      "larger-than-declared-streamed",
      rawZip([
        { name: "Foo/Foo.toc", content: TOC },
        { name: "Foo/bomb.blp", content: halfCompressible(3_000_000, 5), declaredSize: 100 },
      ]),
    );
    await expect(extractArchive(zipPath, dest)).rejects.toThrow(/damaged/);
    expect(readFileSync(join(dest, "Foo/bomb.blp")).length).toBeLessThanOrEqual(100);
  });

  for (const [size, how] of [[50_000, "small"], [3_000_000, "large"]] as const) {
    test(`a ${how} entry whose data does not inflate is damaged`, async () => {
      const bytes = rawZip([{ name: "Foo/Foo.toc", content: TOC }, { name: "Foo/Foo.lua", content: halfCompressible(size, 3) }]);
      // Overwrite the middle of the second entry's deflate stream.
      const at = bytes.indexOf("Foo/Foo.lua") + "Foo/Foo.lua".length + 100;
      bytes.fill(0x07, at, at + 2000); // block type 3 is reserved
      const { zipPath, dest } = fixture(`garbled-${how}`, bytes);
      await expect(extractArchive(zipPath, dest)).rejects.toThrow(/damaged/);
    });
  }

  test("an entry shorter than declared is damaged", async () => {
    const { zipPath, dest } = fixture(
      "smaller-than-declared",
      rawZip([{ name: "Foo/Foo.toc", content: TOC, declaredSize: TOC.length + 1 }]),
    );
    await expect(extractArchive(zipPath, dest)).rejects.toThrow(/damaged/);
  });

  test("a zip cut short is damaged", async () => {
    const whole = zipSync({ "Foo/Foo.toc": TOC, "Foo/Foo.lua": halfCompressible(50_000, 4) });
    const { zipPath, dest } = fixture("cut-short", whole.subarray(0, whole.length - 40));
    await expect(extractArchive(zipPath, dest)).rejects.toThrow(/damaged/);
  });

  test("a compression method other than stored or deflate is damaged", async () => {
    const bytes = rawZip([{ name: "Foo/Foo.toc", content: TOC }]);
    bytes.writeUInt16LE(12, bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10); // bzip2
    const { zipPath, dest } = fixture("method", bytes);
    await expect(extractArchive(zipPath, dest)).rejects.toThrow(/damaged/);
  });

  test("an unsafe name rejects the archive before any file is written", async () => {
    const { zipPath, dest } = fixture(
      "unsafe-last",
      zipSync({ "Foo/Foo.toc": TOC, "Foo/../../evil.lua": text("pwned") }),
    );
    await expect(extractArchive(zipPath, dest)).rejects.toThrow(/unsafe files/);
    expect(existsSync(dest)).toBe(false);
  });
});

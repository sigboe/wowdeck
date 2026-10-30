import { describe, expect, test } from "bun:test";
import { qrCode } from "./qr";

/** The dark modules of one row of the path, as [x, length] runs. */
function runsOnRow(path: string, y: number): [number, number][] {
  return [...path.matchAll(/M(\d+) (\d+)h(\d+)/g)]
    .filter((m) => Number(m[2]) === y)
    .map((m) => [Number(m[1]), Number(m[3])]);
}

describe("qrCode", () => {
  test("a short URL is a version 2 code (25 modules, medium error correction) inside a one-module border", () => {
    expect(qrCode("https://ko-fi.com/wowdeck").size).toBe(27);
  });

  test("the three finder squares sit in their corners", () => {
    const { size, path } = qrCode("https://ko-fi.com/wowdeck");
    const top = runsOnRow(path, 1);
    // Top row of the top-left and top-right finders: 7 dark modules each.
    expect(top[0]).toEqual([1, 7]);
    expect(top[top.length - 1]).toEqual([size - 8, 7]);
    // Bottom-left finder's last row.
    expect(runsOnRow(path, size - 2)[0]).toEqual([1, 7]);
  });

  test("any URL gets a code: longer URLs get a bigger one, different URLs a different one", () => {
    const short = qrCode("https://ko-fi.com/a");
    const long = qrCode(`https://www.paypal.com/donate/?hosted_button_id=${"X".repeat(120)}`);
    expect(long.size).toBeGreaterThan(short.size);
    expect(qrCode("https://ko-fi.com/b").path).not.toBe(short.path);
    expect(qrCode("https://ko-fi.com/a")).toEqual(short);
  });
});

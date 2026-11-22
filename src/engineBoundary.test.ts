/// <reference types="bun-types" />
/**
 * The frontend reaches the engine through engineLink.ts only: Decky's
 * adapter (services/backend.ts) is connected once, at plugin load, and tests
 * connect the typed fake. These checks read the sources, so a shortcut
 * around the seam fails here instead of on the device.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = import.meta.dir;
const files = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => ({ path: relative(SRC, join(SRC, f)), text: readFileSync(join(SRC, f), "utf8") }));
const isTest = (path: string) => /\.test\.tsx?$/.test(path);
const THIS_FILE = "engineBoundary.test.ts";

describe("the engine seam", () => {
  test("only the plugin's load imports Decky's engine adapter", () => {
    const importers = files
      .filter((f) => f.path !== THIS_FILE && /from "[./]*services\/backend"/.test(f.text))
      .map((f) => f.path);
    expect(importers).toEqual(["index.tsx"]);
  });

  test("components never subscribe to engine events", () => {
    const subscribers = files
      .filter(
        (f) => f.path.startsWith("components/") && /engine\.events|connectEngine/.test(f.text),
      )
      .map((f) => f.path);
    expect(subscribers).toEqual([]);
  });

  test("tests use the typed fake, not Decky's callable or a replaced backend module", () => {
    const untyped = files
      .filter(
        (f) =>
          isTest(f.path) &&
          f.path !== THIS_FILE &&
          (/\bcallable\s*:/.test(f.text) || /mock\.module\("[./]*services\/backend"/.test(f.text)),
      )
      .map((f) => f.path);
    expect(untyped).toEqual([]);
  });
});

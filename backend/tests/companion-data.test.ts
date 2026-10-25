/**
 * Pure builders for the WowUp.Addon companion-data bridge — no
 * filesystem, no AddonService. See companion-sync.test.ts for the
 * end-to-end fixture-installation coverage.
 */

import { describe, expect, test } from "bun:test";
import { buildCompanionToc, buildDataLua, luaString } from "../src/wow/notifications/companion-data";
import { toInterfaceVersion } from "../src/wow/utils/gameversion";

describe("toInterfaceVersion", () => {
  test("converts a clean 3-part version", () => {
    expect(toInterfaceVersion("11.0.2")).toBe("110002");
  });

  test("matches the real Classic Era interface number", () => {
    expect(toInterfaceVersion("1.15.7")).toBe("11507");
  });

  test("uses only the first 3 parts of a 4-part Battle.net build string", () => {
    expect(toInterfaceVersion("11.0.2.56177")).toBe("110002");
  });

  test("double-digit minor/patch are not re-padded", () => {
    expect(toInterfaceVersion("11.11.11")).toBe("111111");
  });

  test("rejects a too-short version instead of guessing", () => {
    expect(toInterfaceVersion("11.0")).toBeUndefined();
  });

  test("rejects non-numeric parts instead of guessing", () => {
    expect(toInterfaceVersion("11.x.2")).toBeUndefined();
  });

  test("rejects an empty string", () => {
    expect(toInterfaceVersion("")).toBeUndefined();
  });
});

describe("luaString escaping", () => {
  test("wraps a plain string in quotes", () => {
    expect(luaString("Bagnon")).toBe('"Bagnon"');
  });

  test("escapes embedded double quotes", () => {
    expect(luaString('Say "Hi"')).toBe('"Say \\"Hi\\""');
  });

  test("escapes backslashes before quotes/newlines so they can't combine into a new escape", () => {
    expect(luaString("C:\\Addons\\Foo")).toBe('"C:\\\\Addons\\\\Foo"');
  });

  test("escapes newlines, carriage returns and tabs", () => {
    expect(luaString("a\nb\rc\td")).toBe('"a\\nb\\rc\\td"');
  });

  test("passes multi-byte UTF-8 through untouched", () => {
    expect(luaString("Déjà Vu 你好 🎮")).toBe('"Déjà Vu 你好 🎮"');
  });

  test("a value built only from the escaped pieces never terminates the string early", () => {
    const evil = '"}); os.execute("rm -rf /") --';
    const escaped = luaString(evil);
    // the only unescaped quotes are the two literal wrapping quotes
    const inner = escaped.slice(1, -1);
    expect(inner.includes('\\"') || !inner.includes('"')).toBe(true);
  });
});

describe("buildDataLua", () => {
  test("produces an empty, syntactically closed table when there are no updates", () => {
    const lua = buildDataLua([], new Date("2026-10-11T00:00:00.000Z"));
    expect(lua).toContain("WOWUP_DATA.updateAddonsList = {");
    expect(lua.trim().endsWith("}")).toBe(true);
    expect(lua).toContain("WOWUP_DATA.addonManagerName");
  });

  test("includes one row per update with name/current/new version", () => {
    const lua = buildDataLua(
      [
        { name: "Bagnon", currentVersion: "1.0.0", newVersion: "1.1.0" },
        { name: "WeakAuras", currentVersion: "5.0", newVersion: "5.1" },
      ],
      new Date(),
    );
    expect(lua).toContain('["Bagnon"] = {"1.0.0", "1.1.0"}');
    expect(lua).toContain('["WeakAuras"] = {"5.0", "5.1"}');
  });

  test("escapes special characters in addon names and versions", () => {
    const lua = buildDataLua(
      [{ name: 'Weird "Addon"\\Name', currentVersion: "1.0", newVersion: "2.0" }],
      new Date(),
    );
    expect(lua).toContain('["Weird \\"Addon\\"\\\\Name"] = {"1.0", "2.0"}');
  });

  test("handles missing version strings safely (empty, not undefined/null leaking into Lua)", () => {
    const lua = buildDataLua([{ name: "Mystery", currentVersion: "", newVersion: "" }], new Date());
    expect(lua).toContain('["Mystery"] = {"", ""}');
    expect(lua).not.toContain("undefined");
    expect(lua).not.toContain("null");
  });

  test("two installations with the same addon name but different versions produce independent rows", () => {
    const retail = buildDataLua([{ name: "Bagnon", currentVersion: "1.0", newVersion: "2.0" }], new Date());
    const classic = buildDataLua([{ name: "Bagnon", currentVersion: "9.0", newVersion: "9.1" }], new Date());
    expect(retail).toContain('{"1.0", "2.0"}');
    expect(classic).toContain('{"9.0", "9.1"}');
    expect(retail).not.toContain("9.0");
    expect(classic).not.toContain('{"1.0", "2.0"}');
  });
});

describe("buildCompanionToc", () => {
  test("includes the verified Interface/RequiredDeps/DefaultState contract", () => {
    const toc = buildCompanionToc({ interfaceVersion: "110002", dataVersion: "1" });
    expect(toc).toContain("## Interface: 110002");
    expect(toc).toContain("## RequiredDeps: WowUp");
    expect(toc).toContain("## DefaultState: enabled");
    expect(toc).toContain("data.lua");
  });
});

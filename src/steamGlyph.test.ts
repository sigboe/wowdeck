/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { componentExports, isGlyphModule, isSteamButtonEnum } from "./steamGlyphLookup";

describe("Steam glyph lookup", () => {
  test("finds the glyph module by its settings hook's source", () => {
    const hook = function k() {
      return ["GamepadUI_KeyboardNavGlyphsDisabled", false];
    };
    expect(isGlyphModule({ Nq: hook, WD: { $$typeof: 1 } })).toBe(true);
    expect(isGlyphModule({ other: () => 1 })).toBe(false);
    expect(isGlyphModule(null)).toBe(false);
  });

  test("component exports are the memo/observer objects only", () => {
    const glyph = { $$typeof: Symbol.for("react.memo") };
    const legend = { $$typeof: Symbol.for("react.memo") };
    expect(componentExports({ XH: legend, WD: glyph, Nq: () => null, s: "x" })).toEqual([
      legend,
      glyph,
    ]);
  });

  test("recognises Steam's button enum, not other enums", () => {
    expect(
      isSteamButtonEnum({ A: 0, LeftBumper: 12, RightBumper: 13, QuickMenu: 9, HomeMenu: 8 }),
    ).toBe(true);
    expect(isSteamButtonEnum({ LeftBumper: 12, RightBumper: 13 })).toBe(false);
    expect(isSteamButtonEnum(undefined)).toBe(false);
  });
});

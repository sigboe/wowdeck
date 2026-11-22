import { expect, mock, test } from "bun:test";
import { memo } from "react";
import { deckyUiStub } from "./deckyUiStub";

mock.module("@decky/ui", () => deckyUiStub);
const { createSteamLookup } = await import("./steamLookup");
const { findSteamGlyphParts } = await import("./steamGlyphLookup");

const buttons = { LeftBumper: 12, RightBumper: 13, QuickMenu: 1, HomeMenu: 2 };
const settingsHook = () => "GamepadUI_KeyboardNavGlyphsDisabled";
const glyph = memo(() => null);
const unrelated = memo(() => null);
const legend = ({ rgButtons, description }: { rgButtons: number[]; description: string }) =>
  rgButtons.length ? description : null;

const viteScope = {
  settingsHook,
  glyph,
  buttons,
  unrelated,
  legend,
  tabBar: function () {},
};
viteScope.tabBar.toString = () =>
  "function t(){return [(0,J.jsx)(glyph,{bAllowKeyboard:!0,button:buttons.LeftBumper}),(0,J.jsx)(glyph,{bAllowKeyboard:!0,button:buttons.RightBumper})]}";

test("Vite uses just the component Steam renders for both bumpers", () => {
  const steam = createSteamLookup({
    findScope: (filter) => (filter(viteScope) ? viteScope : undefined),
    findModuleScopeByVar: (filter) => (filter(settingsHook) ? viteScope : undefined),
    findVar: (filter) => (filter(buttons) ? buttons : undefined),
  });
  const result = findSteamGlyphParts(steam);
  expect(result.components).toHaveLength(1);
  expect(result.components[0]).toBe(glyph);
  expect(result.buttons).toBe(buttons);
});

test("webpack keeps both component exports and skips Vite scope lookup", () => {
  const footer = memo(legend);
  const exported = { settingsHook, glyph, footer };
  const findScope = mock(() => viteScope);
  const steam = createSteamLookup({
    findModule: (filter) => (filter(exported) ? exported : undefined),
    findModuleExport: (filter) => (filter(buttons) ? buttons : undefined),
    findModuleScopeByVar: findScope,
  });
  expect(findSteamGlyphParts(steam)).toEqual({ components: [glyph, footer], buttons });
  expect(findScope).not.toHaveBeenCalled();
});

test("Vite falls back when two memo components each match both bumpers", () => {
  const otherTabBar = function () {};
  otherTabBar.toString = () => String(viteScope.tabBar).replace(/glyph/g, "unrelated");
  const steam = createSteamLookup({
    findModuleScopeByVar: () => ({ ...viteScope, otherTabBar }),
    findVar: () => buttons,
  });
  expect(findSteamGlyphParts(steam).components).toEqual([]);
});

test("Vite falls back when the bumper calls refer to a context", () => {
  const steam = createSteamLookup({
    findModuleScopeByVar: () => ({
      ...viteScope,
      glyph: { $$typeof: Symbol.for("react.context") },
    }),
    findVar: () => buttons,
  });
  expect(findSteamGlyphParts(steam).components).toEqual([]);
});

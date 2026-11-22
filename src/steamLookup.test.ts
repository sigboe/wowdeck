import { describe, expect, mock, test } from "bun:test";
import { deckyUiStub } from "./deckyUiStub";
import type { DeckyLookupApi } from "./steamLookup";

// The module binds the loaded Decky at import; the real @decky/ui needs Steam.
mock.module("@decky/ui", () => deckyUiStub);
const { createSteamLookup } = await import("./steamLookup");

const isMarked = (candidate: unknown) => (candidate as { mark?: string } | null)?.mark === "x";
const marked = { mark: "x" };

/** Decky 3 on the webpack client: everything is exported, no module-scope search. */
const decky3 = (found: unknown): DeckyLookupApi => ({
  findModule: (filter) => (filter(found) ? found : undefined),
  findModuleExport: (filter) => (filter(found) ? found : undefined),
  findModuleByExport: (filter) => (filter(found) ? { found } : undefined),
  findClassModule: (filter) => (filter(found as Record<string, unknown>) ? found : undefined),
});

/** Decky 4 on the Vite client: nothing exported, found in module scope. */
const decky4 = (found: unknown, tables: Partial<DeckyLookupApi> = {}): DeckyLookupApi => ({
  findModule: () => undefined,
  findModuleExport: () => undefined,
  findModuleByExport: () => undefined,
  findClassModule: () => undefined,
  findVar: (filter) => (filter(found) ? found : undefined),
  findModuleScopeByVar: (filter) => (filter(found) ? { found } : undefined),
  findScope: (filter) => (filter(found) ? found : undefined),
  ...tables,
});

describe("finding Steam's components and modules", () => {
  test("Decky 3: the webpack export is found", () => {
    const lookup = createSteamLookup(decky3(marked));
    expect(lookup.findExport(isMarked)).toBe(marked);
    expect(lookup.findModuleWith(isMarked)).toEqual({ found: marked });
    expect(lookup.findModule(isMarked)).toBe(marked);
  });

  test("Decky 4: a module-scope variable is found when nothing exports it", () => {
    const lookup = createSteamLookup(decky4(marked));
    expect(lookup.findExport(isMarked)).toBe(marked);
    expect(lookup.findModuleWith(isMarked)).toEqual({ found: marked });
    expect(lookup.findModule(isMarked)).toBe(marked);
  });

  test("the export wins when both have it", () => {
    const exported = { mark: "x", from: "export" };
    const lookup = createSteamLookup({ ...decky4(marked), findModuleExport: () => exported });
    expect(lookup.findExport(isMarked)).toBe(exported);
  });

  test("neither has it: undefined, and a throwing search counts as missing", () => {
    const throwing = () => {
      throw new Error("Steam changed");
    };
    const lookup = createSteamLookup({
      findModuleExport: throwing,
      findVar: () => undefined,
      findModule: throwing,
      findModuleByExport: throwing,
    });
    expect(lookup.findExport(isMarked)).toBeUndefined();
    expect(lookup.findModule(isMarked)).toBeUndefined();
    expect(lookup.findModuleWith(isMarked)).toBeUndefined();
  });

  test("a throwing export search still falls through to module scope", () => {
    const lookup = createSteamLookup({
      ...decky4(marked),
      findModuleExport: () => {
        throw new Error("no webpack");
      },
    });
    expect(lookup.findExport(isMarked)).toBe(marked);
  });
});

describe("finding Steam's CSS classes", () => {
  const keys = ["ViewPlaceholder", "Expanded"] as const;

  test("Decky 3: the CSS module is found by its readable keys", () => {
    const css = { ViewPlaceholder: "a", Expanded: "b", Open: "c" };
    expect(createSteamLookup(decky3(css)).findClasses(keys, "quickAccessMenuClasses")).toBe(css);
  });

  test("Decky 4: obfuscated keys, so Decky's mapped table is used", () => {
    const table = { ViewPlaceholder: "a", Expanded: "b", QuickAccessMenuEmbeddedContainer: "c" };
    const lookup = createSteamLookup(decky4(undefined, { quickAccessMenuClasses: table }));
    expect(lookup.findClasses(keys, "quickAccessMenuClasses")).toBe(table);
  });

  test("Decky's table missing a required class: undefined", () => {
    // Decky 4 leaves unmapped classes as "" (its defaults); Decky 3's table
    // for the QAM is another module, without Expanded.
    for (const table of [{ ViewPlaceholder: "a", Expanded: "" }, { ViewPlaceholder: "a" }]) {
      const lookup = createSteamLookup(decky4(undefined, { quickAccessMenuClasses: table }));
      expect(lookup.findClasses(keys, "quickAccessMenuClasses")).toBeUndefined();
    }
  });

  test("a module without every required key isn't taken", () => {
    const lookup = createSteamLookup(decky3({ ViewPlaceholder: "a" }));
    expect(lookup.findClasses(keys, "quickAccessMenuClasses")).toBeUndefined();
  });
});

import { describe, expect, test } from "bun:test";
import type { AddonRecord } from "../src/wow/addons/AddonRecords";
import { libraryFlagsAfterImport, libraryNeeds } from "../src/wow/addons/libraries";
import type { AddonFolder } from "../src/wow/models";
import { AddonDependencyType, WowClientType } from "../src/wow/types";

const rec = (
  id: string,
  providerName: string,
  externalId: string,
  { requires = [], isDependency = false, folders = [id] }: { requires?: string[]; isDependency?: boolean; folders?: string[] } = {},
): AddonRecord => ({
  id,
  name: id,
  installationId: "i",
  channelType: 0,
  isIgnored: false,
  isLoadOnDemand: false,
  providerName,
  externalId,
  isDependency,
  installedFolderList: folders,
  dependencies: requires.map((externalAddonId) => ({ externalAddonId, type: AddonDependencyType.Required })),
});

/** An AddOns folder whose TOC names these dependencies. */
const folder = (name: string, { required = [], optional = [] }: { required?: string[]; optional?: string[] } = {}): AddonFolder => ({
  name,
  path: `/AddOns/${name}`,
  status: "",
  tocs: [
    {
      fileName: `${name}.toc`,
      filePath: `/AddOns/${name}/${name}.toc`,
      title: name,
      interface: ["110005"],
      dependencyList: required,
      optionalDependencyList: optional,
    },
  ],
});

const needsOf = (records: AddonRecord[], folders: AddonFolder[] = []) => libraryNeeds(records, folders, WowClientType.Retail);

describe("who needs a library", () => {
  test("a source list matches by provider and id, so equal ids on two providers don't mix", () => {
    const curseLib = rec("curseLib", "Curse", "5", { isDependency: true });
    const wagoApp = rec("wagoApp", "Wago", "9", { requires: ["5"] });
    const curseApp = rec("curseApp", "Curse", "9", { requires: ["5"] });
    expect(needsOf([curseLib, wagoApp]).neededBy(curseLib)).toEqual([]);
    expect(needsOf([curseLib, curseApp]).neededBy(curseLib)).toEqual(["curseApp"]);
  });

  test("a TOC naming one of its folders, required or optional, whatever the provider and case", () => {
    const lib = rec("Syndicator", "GitHub", "x", { isDependency: true, folders: ["Syndicator", "Syndicator_Data"] });
    const optional = rec("Baganator", "File", "b");
    const required = rec("Other", "Curse", "o");
    const needs = needsOf(
      [lib, optional, required],
      [folder("Syndicator"), folder("Baganator", { optional: ["syndicator"] }), folder("Other", { required: ["Syndicator_Data"] })],
    );
    expect(needs.neededBy(lib)).toEqual(["Baganator", "Other"]);
  });

  test("an addon that moved off CurseForge still needs the library its TOC names (takeover, Change source)", () => {
    // Baganator came from a file: its stored source list is empty now.
    const syndicator = rec("Syndicator", "Curse", "100", { isDependency: true });
    const baganator = rec("Baganator", "File", "bag.zip");
    const needs = needsOf([syndicator, baganator], [folder("Syndicator"), folder("Baganator", { optional: ["Syndicator"] })]);
    expect(needs.neededBy(syndicator)).toEqual(["Baganator"]);
  });

  test("a library that moved off CurseForge stays needed by its dependant's TOC", () => {
    // Baganator's CurseForge list still names 100, Syndicator's old CurseForge id.
    const syndicator = rec("Syndicator", "GitHub", "kemayo/syndicator", { isDependency: true });
    const baganator = rec("Baganator", "Curse", "200", { requires: ["100"] });
    const folders = [folder("Syndicator"), folder("Baganator", { optional: ["Syndicator"] })];
    expect(needsOf([syndicator, baganator]).neededBy(syndicator)).toEqual([]);
    expect(needsOf([syndicator, baganator], folders).neededBy(syndicator)).toEqual(["Baganator"]);
  });

  test("an unmanaged folder's TOC counts; an addon's TOC naming its own folders doesn't", () => {
    const lib = rec("Lib", "Curse", "1", { isDependency: true, folders: ["Lib", "Lib_Options"] });
    const own = folder("Lib_Options", { required: ["Lib"] });
    expect(needsOf([lib], [folder("Lib"), own]).neededBy(lib)).toEqual([]);
    expect(needsOf([lib], [folder("Lib"), own, folder("Loose", { required: ["Lib"] })]).neededBy(lib)).toEqual(["Loose"]);
  });
});

describe("what a Remove leaves unneeded", () => {
  test("the libraries only it needed, and those only they needed, dependants first", () => {
    const app = rec("app", "Curse", "1", { requires: ["2"] });
    const lib = rec("lib", "Curse", "2", { isDependency: true, requires: ["3"] });
    const deep = rec("deep", "Curse", "3", { isDependency: true });
    expect(needsOf([deep, lib, app]).leftUnneeded(["app"])).toEqual([lib, deep]);
  });

  test("never a library something else still needs, by source list or TOC", () => {
    const app = rec("app", "Curse", "1", { requires: ["2", "3"] });
    const byList = rec("byList", "Curse", "2", { isDependency: true });
    const byToc = rec("byToc", "Curse", "3", { isDependency: true });
    const other = rec("other", "Curse", "4", { requires: ["2"] });
    const needs = needsOf([app, byList, byToc, other], [folder("byToc"), folder("Loose", { optional: ["byToc"] })]);
    expect(needs.leftUnneeded(["app"])).toEqual([]);
  });

  test("never a library that was unneeded already, nor an addon the user chose", () => {
    const app = rec("app", "Curse", "1", { requires: ["3"] });
    const unneeded = rec("unneeded", "Curse", "2", { isDependency: true });
    const chosen = rec("chosen", "Curse", "3");
    expect(needsOf([app, unneeded, chosen]).leftUnneeded(["app"])).toEqual([]);
    expect(needsOf([app, unneeded, chosen]).leftUnneeded(["unrelated"])).toEqual([]);
  });

  test("a library kept (its removal failed) keeps the ones only it needed", () => {
    const app = rec("app", "Curse", "1", { requires: ["2"] });
    const lib = rec("lib", "Curse", "2", { isDependency: true, requires: ["3"] });
    const deep = rec("deep", "Curse", "3", { isDependency: true });
    const needs = needsOf([app, lib, deep]);
    expect(needs.leftUnneeded(["app"], ["lib"])).toEqual([]);
    expect(needs.leftUnneeded(["app", "lib"])).toEqual([deep]);
  });
});

describe("library flags after an import", () => {
  test("a library only if the list marks it and something needs it; others untouched", () => {
    const required = rec("required", "Curse", "1");
    const unneeded = rec("unneeded", "Curse", "2", { isDependency: true });
    const unmarked = rec("unmarked", "Curse", "3", { isDependency: true });
    const app = rec("app", "Curse", "4", { requires: ["1", "3"] });
    const notImported = rec("notImported", "Curse", "5", { isDependency: true });
    const records = [required, unneeded, unmarked, app, notImported];
    const imported = new Map([
      ["required", true],
      ["unneeded", true],
      ["unmarked", false],
      ["app", false],
    ]);
    expect(libraryFlagsAfterImport(records, needsOf(records), imported)).toEqual([
      { id: "required", isDependency: true },
      { id: "unneeded", isDependency: false },
      { id: "unmarked", isDependency: false },
    ]);
  });
});

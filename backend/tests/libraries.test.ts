import { describe, expect, test } from "bun:test";
import type { AddonRecord } from "../src/wow/addons/AddonRecords";
import { dependantsIndex, libraryFlagsAfterImport, orphanedLibraries } from "../src/wow/addons/libraries";
import { AddonDependencyType } from "../src/wow/types";

const rec = (id: string, providerName: string, externalId: string, requires: string[] = [], isDependency = false): AddonRecord => ({
  id,
  name: id,
  installationId: "i",
  channelType: 0,
  isIgnored: false,
  isLoadOnDemand: false,
  providerName,
  externalId,
  isDependency,
  dependencies: requires.map((externalAddonId) => ({ externalAddonId, type: AddonDependencyType.Required })),
});

describe("libraries", () => {
  test("dependants are matched by provider and id, so equal ids on two providers don't mix", () => {
    const curseLib = rec("curseLib", "Curse", "5", [], true);
    const wagoApp = rec("wagoApp", "Wago", "9", ["5"]);
    const dependants = dependantsIndex([curseLib, wagoApp]);
    expect(dependants(curseLib)).toEqual([]);
    expect(orphanedLibraries([curseLib, wagoApp])).toEqual([curseLib]);
  });

  test("a library someone requires is not an orphan; an addon the user chose never is", () => {
    const lib = rec("lib", "Curse", "1", [], true);
    const app = rec("app", "Curse", "2", ["1"]);
    const unused = rec("unused", "Curse", "3");
    expect(dependantsIndex([lib, app, unused])(lib)).toEqual([app]);
    expect(orphanedLibraries([lib, app, unused])).toEqual([]);
  });

  test("after an import: a library only if the list marks it and something requires it; others untouched", () => {
    const required = rec("required", "Curse", "1");
    const orphan = rec("orphan", "Curse", "2", [], true);
    const unmarked = rec("unmarked", "Curse", "3", [], true);
    const app = rec("app", "Curse", "4", ["1", "3"]);
    const notImported = rec("notImported", "Curse", "5", [], true);
    const imported = new Map([
      ["required", true],
      ["orphan", true],
      ["unmarked", false],
      ["app", false],
    ]);
    expect(libraryFlagsAfterImport([required, orphan, unmarked, app, notImported], imported)).toEqual([
      { id: "required", isDependency: true },
      { id: "orphan", isDependency: false },
      { id: "unmarked", isDependency: false },
    ]);
  });
});

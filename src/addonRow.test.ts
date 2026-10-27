/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { Addon } from "./types";
import {
  addonActions,
  addonProblemText,
  addonRowDescription,
  canQuickUpdate,
  filterAddons,
  isLibrary,
  isNeverTouched,
  isUnmanaged,
  removedAlong,
  providerLabel,
  rowQuickAction,
  sortAddons,
} from "./addonRow";

const base: Addon = {
  id: "a1",
  installationId: "i1",
  folderName: "Details",
  name: "Details! Damage Meter",
  version: "2024.11.3",
  author: null,
  notes: null,
  interfaceVersion: null,
  dependencies: [],
  optionalDependencies: [],
  loadOnDemand: false,
  providerId: "Curse",
  externalId: "61284",
  externalUrl: null,
  gameVersion: null,
  availableVersion: null,
  updateAvailable: false,
  ignored: false,
  broken: false,
  thumbnailUrl: null,
  missingDependencies: [],
  installedAsDependency: false,
  neededBy: [],
  previousVersion: null,
  autoUpdatePaused: false,
  newlyUpdated: false,
  ignoreReason: null,
  problem: null,
  sourceOff: false,
  canReinstall: false,
  channel: "stable",
  canChangeChannel: false,
};

describe("providerLabel", () => {
  test("maps engine ids to the names people know", () => {
    expect(providerLabel("Curse")).toBe("CurseForge");
    expect(providerLabel("WowInterface")).toBe("WoWInterface");
    expect(providerLabel(null)).toBe("Installed manually");
    expect(providerLabel("Other")).toBe("Other");
  });
});

describe("addonRowDescription", () => {
  test("shows the new version only when an update is offered", () => {
    const d = addonRowDescription({
      ...base,
      updateAvailable: true,
      availableVersion: "2024.12.1",
    });
    expect(d).toEqual({ base: "CurseForge · 2024.11.3", newVersion: "2024.12.1", flags: "" });
  });
  test("an ignored addon shows no new version (the row's tag says ignored)", () => {
    const d = addonRowDescription({
      ...base,
      ignored: true,
    });
    expect(d.newVersion).toBeNull();
    expect(d.flags).toBe("");
  });
  test("unmanaged folders", () => {
    expect(addonRowDescription({ ...base, providerId: null }).base).toBe("Installed manually");
  });
});

describe("addonActions", () => {
  test("update first, remove last and destructive", () => {
    const ids = addonActions({ ...base, updateAvailable: true, availableVersion: "2" }, false);
    expect(ids.map((a) => a.id)).toEqual([
      "update",
      "details",
      "ignore",
      "changeSource",
      "folders",
      "remove",
    ]);
    expect(ids[0]!.tone).toBe("emphasis");
    expect(ids[ids.length - 1]!.tone).toBe("destructive");
  });
  test("no update entry without an update; unignore when ignored", () => {
    expect(addonActions({ ...base, ignored: true }, false).map((a) => a.id)).toEqual([
      "details",
      "unignore",
      "changeSource",
      "folders",
      "remove",
    ]);
  });
  test("unmanaged folders can be given a source or removed (WF-23)", () => {
    expect(addonActions({ ...base, providerId: null }, false).map((a) => a.id)).toEqual([
      "findSource",
      "folders",
      "remove",
    ]);
  });
  test("busy disables everything except Details and Folders (read-only)", () => {
    const actions = addonActions({ ...base, updateAvailable: true }, true);
    expect(actions.filter((a) => !a.disabled).map((a) => a.id)).toEqual(["details", "folders"]);
  });
});

describe("canQuickUpdate", () => {
  // Ignored, source off and unmanaged addons arrive with updateAvailable false (engine updateStatus).
  test("the engine's updateAvailable decides", () => {
    expect(canQuickUpdate({ ...base, updateAvailable: true })).toBe(true);
    expect(canQuickUpdate({ ...base, ignored: true })).toBe(false);
    expect(canQuickUpdate({ ...base, sourceOff: true })).toBe(false);
    expect(canQuickUpdate(base)).toBe(false);
  });
});

describe("rowQuickAction", () => {
  test("X updates a managed row, finds a source for an unmanaged one", () => {
    expect(rowQuickAction({ ...base, updateAvailable: true })?.id).toBe("update");
    expect(rowQuickAction(base)).toBeNull();
    expect(rowQuickAction({ ...base, providerId: null })).toEqual({
      id: "findSource",
      label: "Find online source",
    });
    const git = { ...base, providerId: null, ignored: true, ignoreReason: "git_repo" as const };
    expect(rowQuickAction(git)).toBeNull();
  });
});

describe("why an addon is ignored or needs attention (WF-04)", () => {
  test("each problem has its own short text", () => {
    expect(addonProblemText({ ...base, broken: true, problem: "folders_missing" })).toBe(
      "files missing",
    );
    expect(addonProblemText({ ...base, broken: true, problem: "not_on_provider" })).toBe(
      "not on CurseForge",
    );
    expect(addonProblemText(base)).toBeNull();
  });
  test("an older engine without `problem` still says action needed", () => {
    expect(addonProblemText({ ...base, broken: true })).toBe("action needed");
  });
  test("an ignored row still shows its problem", () => {
    const d = addonRowDescription({
      ...base,
      ignored: true,
      ignoreReason: "user",
      broken: true,
      problem: "folders_missing",
    });
    expect(d.flags).toBe("files missing");
  });
  test("a git checkout says what it is and has no actions", () => {
    const git: Addon = {
      ...base,
      providerId: null,
      externalId: null,
      ignored: true,
      ignoreReason: "git_repo",
    };
    const d = addonRowDescription(git);
    expect(d.base).toBe("Git checkout, not managed");
    expect(d.flags).toBe("");
    expect(addonActions(git, false)).toEqual([]);
    expect(canQuickUpdate(git)).toBe(false);
  });

  test("a Raider.IO client folder says who manages it and has no actions", () => {
    const rio: Addon = {
      ...base,
      providerId: null,
      externalId: null,
      ignored: true,
      ignoreReason: "raiderio_client",
    };
    expect(addonRowDescription(rio).base).toBe("Raider.IO client, not managed");
    expect(addonActions(rio, false)).toEqual([]);
    expect(isNeverTouched(rio)).toBe(true);
    expect(isUnmanaged(rio)).toBe(false);
  });
});

describe("reinstall in the menu (WF-05)", () => {
  const ids = (a: Addon) => addonActions(a, false).map((x) => x.id);
  test("offered after Details when there is no update", () => {
    expect(ids({ ...base, canReinstall: true })).toEqual([
      "details",
      "reinstall",
      "ignore",
      "changeSource",
      "folders",
      "remove",
    ]);
  });
  test("not offered while an update is (Update installs fresh files)", () => {
    expect(
      ids({ ...base, canReinstall: true, updateAvailable: true, availableVersion: "2" }),
    ).toEqual(["update", "details", "ignore", "changeSource", "folders", "remove"]);
  });
  test("leads, highlighted, when files are missing", () => {
    const actions = addonActions(
      {
        ...base,
        canReinstall: true,
        broken: true,
        problem: "folders_missing",
        updateAvailable: true,
        availableVersion: "2",
      },
      false,
    );
    expect(actions.map((x) => x.id)).toEqual([
      "reinstall",
      "update",
      "details",
      "ignore",
      "changeSource",
      "folders",
      "remove",
    ]);
    expect(actions[0]!.tone).toBe("emphasis");
    expect(actions[1]!.tone).toBeUndefined();
  });
  test("absent when the provider does not allow it or an older engine sends nothing", () => {
    expect(ids(base)).not.toContain("reinstall");
    expect(ids({ ...base, canReinstall: false, problem: "folders_missing" })).not.toContain(
      "reinstall",
    );
  });
});

describe("sortAddons (WF-06)", () => {
  const row = (id: string, name: string, extra: Partial<Addon> = {}): Addon => ({
    ...base,
    id,
    name,
    ...extra,
  });
  test("updates, then problems, then the rest, then ignored; by name inside each group", () => {
    const sorted = sortAddons([
      row("1", "zeta"),
      row("2", "Ignored", { ignored: true, ignoreReason: "user", updateAvailable: true }),
      row("3", "beta", { broken: true, problem: "folders_missing" }),
      row("4", "Alpha"),
      row("5", "omega", { updateAvailable: true, availableVersion: "2" }),
      row("6", "Delta", { updateAvailable: true, availableVersion: "2" }),
      row("7", "Git", { providerId: null, ignored: true, ignoreReason: "git_repo" }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["6", "5", "3", "4", "1", "7", "2"]);
  });
  test("newly updated sorts right below updates, above problems (PC-07)", () => {
    const sorted = sortAddons([
      row("1", "zeta"),
      row("2", "beta", { broken: true, problem: "folders_missing" }),
      row("3", "Newer", { newlyUpdated: true }),
      row("4", "omega", { updateAvailable: true, availableVersion: "2" }),
      row("5", "Ignored", { ignored: true, ignoreReason: "user", newlyUpdated: true }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["4", "3", "2", "1", "5"]);
  });
  test("does not change the input array", () => {
    const input = [row("1", "b"), row("2", "a")];
    sortAddons(input);
    expect(input.map((a) => a.id)).toEqual(["1", "2"]);
  });
});

describe("filterAddons (WF-06)", () => {
  const dbm = {
    ...base,
    id: "d",
    name: "DBM - Deadly Boss Mods",
    folderName: "DBM-Core",
    author: "MysticalOS",
  };
  const plater = {
    ...base,
    id: "p",
    name: "Plater Nameplates",
    folderName: "Plater",
    providerId: "WowUpHub",
  };
  const all = [base, dbm, plater];
  test("matches name, folder, author or provider, ignoring case and spaces around", () => {
    expect(filterAddons(all, " deadly ").map((a) => a.id)).toEqual(["d"]);
    expect(filterAddons(all, "dbm-core").map((a) => a.id)).toEqual(["d"]);
    expect(filterAddons(all, "mystical").map((a) => a.id)).toEqual(["d"]);
    expect(filterAddons(all, "wowup hub").map((a) => a.id)).toEqual(["p"]);
  });
  test("blank shows everything; no match shows nothing", () => {
    expect(filterAddons(all, "  ")).toBe(all);
    expect(filterAddons(all, "zzz")).toEqual([]);
  });
});

describe("libraries (WF-22)", () => {
  const lib = {
    ...base,
    id: "l",
    name: "LibCore",
    installedAsDependency: true,
    neededBy: ["UsesLib"],
  };
  const shared = {
    ...base,
    id: "s",
    name: "Shared",
    installedAsDependency: true,
    neededBy: ["UsesLib", "Other"],
  };
  const user = { ...base, id: "u", name: "UsesLib" };
  test("tagged by the flag; the row says who needs it", () => {
    expect(isLibrary(lib)).toBe(true);
    expect(isLibrary(user)).toBe(false);
    expect(addonRowDescription(lib).base).toBe("CurseForge · 2024.11.3 · needed by UsesLib");
    expect(addonRowDescription(shared).base).toBe("CurseForge · 2024.11.3 · needed by UsesLib +1");
  });
  test("removing an addon names the libraries only it needed", () => {
    expect(removedAlong(user, [user, lib, shared])).toEqual(["LibCore"]);
  });
  test("a missing dependency is a problem on the row", () => {
    expect(addonProblemText({ ...base, missingDependencies: ["LibStub"] })).toBe("missing LibStub");
  });
});

describe("roll back (BEYOND-02)", () => {
  test("offered next to the release channel when a previous version is kept", () => {
    const ids = (a: Addon) => addonActions(a, false).map((x) => x.id);
    expect(ids({ ...base, canChangeChannel: true, previousVersion: "1.0" })).toEqual([
      "details",
      "channel",
      "rollback",
      "ignore",
      "changeSource",
      "folders",
      "remove",
    ]);
    expect(
      addonActions({ ...base, previousVersion: "1.0" }, false).find((a) => a.id === "rollback")
        ?.label,
    ).toBe("Roll back to 1.0");
    expect(ids(base)).not.toContain("rollback");
  });
  test("a rollback that returned the kept newer version offers to undo it (S15)", () => {
    expect(
      addonActions(
        { ...base, previousVersion: "1.1", updateAvailable: true, availableVersion: "1.1" },
        false,
      ).find((a) => a.id === "rollback")?.label,
    ).toBe("Undo rollback (1.1)");
    // A kept older version while an even newer update is out stays a rollback.
    expect(
      addonActions(
        { ...base, previousVersion: "1.0", updateAvailable: true, availableVersion: "1.2" },
        false,
      ).find((a) => a.id === "rollback")?.label,
    ).toBe("Roll back to 1.0");
  });
});

describe("automatic updates paused per addon (WF-02)", () => {
  test("Pause/Resume only when automatic updates are on, after the rollback item", () => {
    const ids = (a: Addon, on: boolean) => addonActions(a, false, on).map((x) => x.id);
    expect(ids({ ...base, previousVersion: "1.0" }, true)).toEqual([
      "details",
      "rollback",
      "pauseAuto",
      "ignore",
      "changeSource",
      "folders",
      "remove",
    ]);
    expect(ids({ ...base, autoUpdatePaused: true }, true)).toContain("resumeAuto");
    expect(ids(base, false)).not.toContain("pauseAuto");
  });
});

describe("unmanaged addons (owner, 2026-10-17)", () => {
  test("installed by hand, not a git checkout; sorted with the rows that aren't updated", () => {
    const manual = { ...base, id: "m", name: "Aaa", providerId: null };
    const git = { ...manual, id: "g", ignoreReason: "git_repo" as const, ignored: true };
    expect(isUnmanaged(manual)).toBe(true);
    expect(isUnmanaged(git)).toBe(false);
    expect(isUnmanaged(base)).toBe(false);
    expect(sortAddons([manual, base]).map((a) => a.id)).toEqual([base.id, "m"]);
  });
});

describe("provider names in row text (RF-06 pin)", () => {
  const NAMES: Array<[string, string]> = [
    ["Curse", "CurseForge"],
    ["WowUpHub", "WowUp Hub"],
    ["WowInterface", "WoWInterface"],
    ["TukUI", "TukUI"],
    ["GitHub", "GitHub"],
  ];
  test.each(NAMES)("not on %p reads 'not on %s'", (id, name) => {
    expect(addonProblemText({ ...base, providerId: id, problem: "not_on_provider" })).toBe(
      `not on ${name}`,
    );
  });
  test("an unknown or untrusted id is shown as is", () => {
    expect(providerLabel("Wago")).toBe("Wago");
    // Was Object's own constructor before RF-06 (no own-key guard here).
    expect(providerLabel("constructor")).toBe("constructor");
  });
});

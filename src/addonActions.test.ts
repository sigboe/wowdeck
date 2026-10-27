/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { Addon, OperationResult, SearchResult } from "./types";
import { createAddonActions, type AddonActionDeps } from "./addonActions";

const addon: Addon = {
  id: "a1",
  installationId: "i1",
  folderName: "Details",
  name: "Details",
  version: "1.0",
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

const op = (status: OperationResult["status"], error: string | null = null): OperationResult => ({
  operationId: "op",
  addonId: addon.id,
  status,
  error,
});

/** Actions over a stubbed engine: `answers` maps a method to its result (or an Error to throw). */
function harness(answers: Record<string, unknown>, autoUpdate = false) {
  const log: string[] = [];
  const calls: [string, unknown][] = [];
  const deps: AddonActionDeps = {
    rpc: (async (method: string, params?: unknown) => {
      calls.push([method, params]);
      const answer = answers[method];
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    }) as AddonActionDeps["rpc"],
    toast: (title, body = "") => log.push(body ? `toast ${title} | ${body}` : `toast ${title}`),
    toastError: (title, e) => log.push(`error ${title} | ${e instanceof Error ? e.message : e}`),
    autoUpdateOn: () => autoUpdate,
    setUpdatingAll: (scope) => log.push(`updatingAll ${scope}`),
    begin: (id) => {
      if (id) {
        log.push(`busy ${id} true`);
      }
    },
    settled: (change, id) => {
      if (id) {
        log.push(`busy ${id} false`);
      }
      log.push(
        change === null ? "nothing" : change === "reload" ? "reload" : `apply ${change.version}`,
      );
    },
  };
  return { actions: createAddonActions(deps), log, calls };
}

describe("addon actions: update", () => {
  test("updated: busy, toast with the new version, reload", async () => {
    const h = harness({
      "addons.update": { addon: { ...addon, version: "2.0" }, operation: op("updated") },
    });
    await h.actions.update(addon);
    expect(h.log).toEqual([
      "busy a1 true",
      "toast Updated Details | Version 2.0",
      "busy a1 false",
      "reload",
    ]);
  });

  test("current says so", async () => {
    const h = harness({ "addons.update": { addon, operation: op("current") } });
    await h.actions.update(addon);
    expect(h.log).toContain("toast Details is up to date");
  });

  test("failed shows the engine's error, or an empty one", async () => {
    const h = harness({ "addons.update": { addon, operation: op("failed", "HTTP 404") } });
    await h.actions.update(addon);
    expect(h.log).toContain("error Couldn't update Details | HTTP 404");
    const h2 = harness({ "addons.update": { addon, operation: op("failed") } });
    await h2.actions.update(addon);
    expect(h2.log).toContain("error Couldn't update Details | ");
  });

  test("a rejected call is a generic failure and still clears busy and reloads", async () => {
    const h = harness({ "addons.update": new Error("boom") });
    await h.actions.update(addon);
    expect(h.log).toEqual([
      "busy a1 true",
      "error Something went wrong | boom",
      "busy a1 false",
      "reload",
    ]);
  });
});

describe("addon actions: reinstall, channel, pause, ignore, remove", () => {
  test("reinstall", async () => {
    const ok = harness({ "addons.reinstall": { addon, operation: op("installed") } });
    await ok.actions.reinstall(addon);
    expect(ok.log).toContain("toast Reinstalled Details");
    const bad = harness({ "addons.reinstall": { addon, operation: op("failed", "nope") } });
    await bad.actions.reinstall(addon);
    expect(bad.log).toContain("error Couldn't reinstall Details | nope");
  });

  test("channel switch names the channel and the installed version", async () => {
    const ok = harness({
      "addons.setChannel": { addon: { ...addon, version: "2.0b" }, operation: op("installed") },
    });
    await ok.actions.setChannel(addon, "beta");
    expect(ok.log).toContain("toast Switched Details to Beta | Version 2.0b installed");
    const bad = harness({ "addons.setChannel": { addon, operation: op("failed", "x") } });
    await bad.actions.setChannel(addon, "alpha");
    expect(bad.log).toContain("error Couldn't switch Details to Alpha | x");
  });

  test("pause and resume automatic updates", async () => {
    const h = harness({ "addons.setAutoUpdatePaused": { addon } });
    await h.actions.setAutoUpdatePaused(addon, true);
    await h.actions.setAutoUpdatePaused(addon, false);
    expect(h.calls.map((c) => c[1])).toEqual([
      { addonId: "a1", paused: true },
      { addonId: "a1", paused: false },
    ]);
    expect(h.log).toContain("toast Automatic updates paused | Details");
    expect(h.log).toContain("toast Automatic updates resumed | Details");
  });

  test("ignore says nothing and hands back the engine's addon", async () => {
    const h = harness({ "addons.setIgnored": { addon: { ...addon, version: "1.0i" } } });
    await h.actions.setIgnored(addon, true);
    expect(h.log).toEqual(["busy a1 true", "busy a1 false", "apply 1.0i"]);
  });

  test("remove: managed by id, unmanaged by folder", async () => {
    const h = harness({ "addons.remove": {}, "addons.removeUnmanaged": {} });
    await h.actions.remove(addon);
    await h.actions.remove({ ...addon, providerId: null, folderName: "Loose" });
    expect(h.calls).toEqual([
      ["addons.remove", { addonId: "a1" }],
      ["addons.removeUnmanaged", { folderName: "Loose" }],
    ]);
    expect(h.log.filter((l) => l.startsWith("toast"))).toEqual([
      "toast Removed Details",
      "toast Removed Details",
    ]);
  });
});

describe("addon actions: use a source (WF-23, WF-12)", () => {
  const loose = { ...addon, id: "unmanaged:Loose", providerId: null, folderName: "Loose" };
  const source = { providerId: "Curse", externalId: "61284", name: "Details!" } as SearchResult;

  test("installs the source over the folder and says the old files are kept", async () => {
    const h = harness({
      "addons.adopt": {
        addon: { ...addon, name: "Details!", previousVersion: "0.9" },
        operation: op("installed"),
      },
    });
    await h.actions.useSource(loose, source);
    expect(h.calls).toEqual([
      ["addons.adopt", { folderName: "Loose", providerId: "Curse", externalId: "61284" }],
    ]);
    expect(h.log).toEqual([
      "busy unmanaged:Loose true",
      "toast Details! now updates from CurseForge | Your files are kept: Roll back returns to 0.9.",
      "busy unmanaged:Loose false",
      "reload",
    ]);
  });

  test("a failed install names the source", async () => {
    const h = harness({ "addons.adopt": { addon, operation: op("failed", "HTTP 403") } });
    await h.actions.useSource(loose, source);
    expect(h.log).toContain("error Couldn't install Details! | HTTP 403");
  });

  test("a managed addon changes its source and says where it updates from now", async () => {
    const h = harness({
      "addons.changeSource": {
        addon: { ...addon, name: "Details!", previousVersion: "0.9" },
        operation: op("installed"),
      },
    });
    await h.actions.useSource({ ...addon, providerId: "WowUpHub" }, source);
    expect(h.calls).toEqual([
      ["addons.changeSource", { addonId: addon.id, providerId: "Curse", externalId: "61284" }],
    ]);
    expect(h.log).toContain("toast Details! now updates from CurseForge");
  });
});

describe("addon actions: rollback", () => {
  const rolledBack = { ...addon, version: "0.9", previousVersion: "1.0" };

  test("names the version and how to return", async () => {
    const h = harness({ "addons.rollback": { addon: rolledBack, operation: op("installed") } });
    await h.actions.rollback(addon);
    expect(h.log).toContain(
      "toast Rolled back Details to 0.9 | You can return to 1.0 from its menu.",
    );
  });

  test("with automatic updates on, says the addon is paused", async () => {
    const h = harness(
      {
        "addons.rollback": {
          addon: { ...rolledBack, autoUpdatePaused: true },
          operation: op("installed"),
        },
      },
      true,
    );
    await h.actions.rollback(addon);
    expect(h.log).toContain(
      "toast Rolled back Details to 0.9 | Automatic updates are paused for it. You can return to 1.0 from its menu.",
    );
  });

  test("undoing a rollback returns to the newer version", async () => {
    const kept = {
      ...addon,
      previousVersion: "1.1",
      updateAvailable: true,
      availableVersion: "1.1",
    };
    const h = harness({
      "addons.rollback": { addon: { ...addon, version: "1.1" }, operation: op("installed") },
    });
    await h.actions.rollback(kept);
    expect(h.log).toContain("toast Returned Details to 1.1");
  });

  test("failed", async () => {
    const h = harness({ "addons.rollback": { addon, operation: op("failed", "gone") } });
    await h.actions.rollback(addon);
    expect(h.log).toContain("error Couldn't roll back Details | gone");
  });
});

describe("addon actions: update all", () => {
  test("counts updated and failed, scope sent, reload, then the flag cleared", async () => {
    const h = harness({
      "addons.updateAll": {
        operations: [op("updated"), op("updated"), op("failed"), op("current")],
      },
    });
    await h.actions.updateAll("all");
    expect(h.calls).toEqual([["addons.updateAll", { allInstallations: true }]]);
    expect(h.log).toEqual([
      "updatingAll all",
      "toast Updated 2 addons | 1 addon couldn't be updated",
      "reload",
      "updatingAll null",
    ]);
  });

  test("nothing to do, and a rejected call", async () => {
    const none = harness({ "addons.updateAll": { operations: [op("current")] } });
    await none.actions.updateAll("installation");
    expect(none.log).toContain("toast All addons are up to date");
    const bad = harness({ "addons.updateAll": new Error("offline") });
    await bad.actions.updateAll("installation");
    expect(bad.log).toContain("error Couldn't update addons | offline");
    expect(bad.log.slice(-2)).toEqual(["reload", "updatingAll null"]);
  });
});

describe("addon actions: install", () => {
  const result = { providerId: "Curse", externalId: "61284", name: "Details" } as SearchResult;

  test("installed: toast names the channel, then reload", async () => {
    const h = harness({ "addons.install": { addon, operation: op("installed") } });
    await h.actions.install(result, "beta");
    expect(h.calls).toEqual([
      ["addons.install", { providerId: "Curse", externalId: "61284", channel: "beta" }],
    ]);
    expect(h.log).toEqual(["toast Installed Details | Beta release", "reload"]);
  });

  test("missing dependencies are named, or described when the names can't be read", async () => {
    const missing = { ...op("installed"), missingRequiredDependencies: ["1", "2"] };
    const named = harness({
      "addons.install": { addon, operation: missing },
      "addons.lookup": { addons: [{ name: "LibA" }, { name: "LibB" }] },
    });
    await named.actions.install(result);
    expect(named.log).toContain(
      "toast Details may not work | It needs LibA, LibB, which couldn't be installed. Install it from Get Addons.",
    );
    const unnamed = harness({
      "addons.install": { addon, operation: missing },
      "addons.lookup": new Error("offline"),
    });
    await unnamed.actions.install(result);
    expect(unnamed.log).toContain(
      "toast Details may not work | It needs another addon that couldn't be installed. Install it from Get Addons.",
    );
  });

  test("a failed install changes nothing; a rejected one reloads", async () => {
    const failed = harness({ "addons.install": { addon, operation: op("failed", "HTTP 404") } });
    await failed.actions.install(result);
    expect(failed.log).toEqual(["error Couldn't install Details | HTTP 404", "nothing"]);
    const rejected = harness({ "addons.install": new Error("boom") });
    await rejected.actions.install(result);
    expect(rejected.log).toEqual(["error Couldn't install Details | boom", "reload"]);
  });
});

describe("addon actions: what each one changed in the list", () => {
  const after = { ...addon, version: "after" };
  const last = (h: ReturnType<typeof harness>) => h.log[h.log.length - 1];

  test("flags only: the engine's addon", async () => {
    const pause = harness({ "addons.setAutoUpdatePaused": { addon: after } });
    await pause.actions.setAutoUpdatePaused(addon, true);
    expect(last(pause)).toBe("apply after");
  });

  test("update: up to date or failed is the engine's addon; updated reads the list", async () => {
    for (const [status, change] of [
      ["current", "apply after"],
      ["failed", "apply after"],
      ["updated", "reload"],
    ] as const) {
      const h = harness({ "addons.update": { addon: after, operation: op(status) } });
      await h.actions.update(addon);
      expect(last(h)).toBe(change);
    }
  });

  test("reinstall, channel and rollback read the list unless they failed", async () => {
    const ok = harness({
      "addons.reinstall": { addon: after, operation: op("installed") },
      "addons.setChannel": { addon: after, operation: op("installed") },
      "addons.rollback": { addon: after, operation: op("installed") },
    });
    await ok.actions.reinstall(addon);
    await ok.actions.setChannel(addon, "beta");
    await ok.actions.rollback(addon);
    expect(ok.log.filter((l) => l === "reload")).toHaveLength(3);
    const bad = harness({
      "addons.reinstall": { addon: after, operation: op("failed") },
      "addons.setChannel": { addon: after, operation: op("failed") },
      "addons.rollback": { addon: after, operation: op("failed") },
    });
    await bad.actions.reinstall(addon);
    await bad.actions.setChannel(addon, "beta");
    await bad.actions.rollback(addon);
    expect(bad.log.filter((l) => l === "apply after")).toHaveLength(3);
  });

  test("remove reads the list; a failed source change keeps the engine's addon, a failed adopt changes nothing", async () => {
    const remove = harness({ "addons.remove": {} });
    await remove.actions.remove(addon);
    expect(last(remove)).toBe("reload");
    const source = harness({ "addons.adopt": { addon, operation: op("failed") } });
    await source.actions.useSource({ ...addon, providerId: null }, {
      providerId: "Curse",
      externalId: "1",
      name: "X",
    } as SearchResult);
    expect(last(source)).toBe("nothing");
    const change = harness({ "addons.changeSource": { addon: after, operation: op("failed") } });
    await change.actions.useSource(addon, {
      providerId: "WowInterface",
      externalId: "1",
      name: "X",
    } as SearchResult);
    expect(last(change)).toBe("apply after");
  });
});

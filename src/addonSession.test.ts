/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { Addon, Installation, SearchResult } from "./types";
import {
  createAddonSession,
  installedAddonFor,
  resultInstallLabel,
  resultTags,
  type AddonSessionDeps,
} from "./addonSession";
import { searchDestination } from "./browseDestinations";

const addon = (overrides: Partial<Addon> = {}): Addon =>
  ({
    id: "a1",
    name: "Details",
    providerId: "Curse",
    externalId: "61284",
    updateAvailable: false,
    ignored: false,
    newlyUpdated: false,
    ...overrides,
  }) as Addon;

const installation = (id: string, selected = false) => ({ id, selected }) as Installation;

/** A session over a stubbed engine: `answers` maps a method to its result (or an Error to throw). */
function harness(answers: Record<string, unknown>) {
  const log: string[] = [];
  const deps: AddonSessionDeps = {
    rpc: (async (method: string, params?: unknown) => {
      log.push(params === undefined ? method : `${method} ${JSON.stringify(params)}`);
      const answer = answers[method];
      if (answer instanceof Error) {
        throw answer;
      }
      return typeof answer === "function" ? answer() : answer;
    }) as AddonSessionDeps["rpc"],
    toast: (title, body = "") => log.push(body ? `toast ${title} | ${body}` : `toast ${title}`),
    toastError: (title, e) => log.push(`error ${title} | ${e instanceof Error ? e.message : e}`),
    autoUpdateOn: () => false,
  };
  return { session: createAddonSession(deps), log };
}

describe("addon session: installations", () => {
  test("the engine says which installation is active, not the list order", async () => {
    const { session } = harness({
      "installations.list": { installations: [installation("i1"), installation("i2", true)] },
      "addons.list": { addons: [addon()] },
    });
    await session.reloadAll();
    expect(session.get().selectedId).toBe("i2");
    expect(session.get().addons.map((a) => a.id)).toEqual(["a1"]);
  });

  test("switching selects in the engine first, then resets the list and Get Addons", async () => {
    const { session, log } = harness({
      "installations.select": {},
      "addons.list": { addons: [addon({ id: "b1" })] },
    });
    searchDestination.patch({ query: "details", results: [] });
    let listDuringReload: Addon[] | null = null;
    const off = session.subscribe(() => {
      if (session.get().loads === 1 && listDuringReload === null) {
        listDuringReload = session.get().addons;
      }
    });
    await session.selectInstallation("i2");
    off();
    expect(log).toEqual(['installations.select {"installationId":"i2"}', "addons.list"]);
    expect(listDuringReload!).toEqual([]);
    expect(session.get().selectedId).toBe("i2");
    expect(session.get().addons.map((a) => a.id)).toEqual(["b1"]);
    expect(searchDestination.get()).toMatchObject({ query: "", results: null });
  });

  test("a failed switch keeps the list and re-reads the installations", async () => {
    let selectFails = false;
    const { session, log } = harness({
      "installations.list": { installations: [installation("i1", true)] },
      "addons.list": { addons: [addon()] },
      "installations.select": () => {
        if (selectFails) {
          throw new Error("no such installation");
        }
      },
    });
    await session.reloadAll();
    log.length = 0;
    selectFails = true;
    await session.selectInstallation("i9");
    await Promise.resolve();
    expect(log).toEqual([
      'installations.select {"installationId":"i9"}',
      "error Couldn't switch installation | no such installation",
      "installations.list",
    ]);
    expect(session.get().selectedId).toBe("i1");
    expect(session.get().addons.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("addon session: list reads", () => {
  test("a failed reload keeps the last list and says so", async () => {
    let fail = false;
    const { session, log } = harness({
      "addons.list": () => {
        if (fail) {
          throw new Error("engine down");
        }
        return { addons: [addon()] };
      },
    });
    await session.reloadAddons();
    fail = true;
    await session.reloadAddons();
    expect(session.get().addons.map((a) => a.id)).toEqual(["a1"]);
    expect(session.get().loads).toBe(0);
    expect(log).toContain("error Couldn't load addons | engine down");
  });

  test("a provider refresh replaces the list and counts addons it couldn't check", async () => {
    const { session, log } = harness({ "addons.refresh": { addons: [addon()], failed: 2 } });
    await session.refreshFromProviders();
    expect(session.get().addons).toHaveLength(1);
    expect(log).toContain("toast Couldn't check 2 addons for updates | Try again later");
  });

  test("an update shows busy while it runs, then the list's Updated row", async () => {
    let release!: () => void;
    let reads = 0;
    const h = harness({
      // Each read says which it was, so the list shows how often it was read.
      "addons.list": () => {
        reads++;
        return { addons: [addon({ version: `read ${reads}`, newlyUpdated: reads > 1 })] };
      },
      "addons.update": () =>
        new Promise((r) => {
          h.session.addonsChanged(["a1"]);
          release = () => r({ addon: addon(), operation: { status: "updated" } });
        }),
    });
    const { session } = h;
    await session.reloadAddons();
    // Every state the row passes through: busy, or its version; the refresh button's spinner.
    const seen: string[] = [];
    session.subscribe(() => {
      const { busy, addons, loads } = session.get();
      const state = `${busy.a1 ? "busy" : addons[0]!.version}${loads ? " +refresh" : ""}`;
      if (seen[seen.length - 1] !== state) {
        seen.push(state);
      }
    });
    const running = session.actions.update(addon());
    expect(session.get().busy).toEqual({ a1: true });
    release();
    await running;
    // The row goes from busy straight to the new version: never back to the
    // old one, and the list read doesn't spin the refresh button too.
    expect(seen).toEqual(["busy", "read 2"]);
    expect(resultTags(session.get().addons[0]!)).toEqual(["Installed", "Updated"]);
  });

  test("an install resolves once the list shows it; Update all's bar stays until then", async () => {
    let reads = 0;
    const h = harness({
      "addons.list": () => {
        reads++;
        return { addons: reads > 0 ? [addon({ id: "new" })] : [] };
      },
      "addons.install": { addon: addon({ id: "new" }), operation: { status: "installed" } },
      "addons.updateAll": { operations: [] },
    });
    const { session } = h;
    await session.actions.install({
      providerId: "Curse",
      externalId: "1",
      name: "New",
    } as SearchResult);
    expect(session.get().addons.map((a) => a.id)).toEqual(["new"]);
    let barDuringRead: string | null = null;
    session.subscribe(() => {
      if (session.get().loads > 0) {
        barDuringRead = session.get().updatingAll;
      }
    });
    await session.actions.updateAll("installation");
    expect(barDuringRead!).toBe("installation");
    expect(session.get().updatingAll).toBeNull();
    expect(reads).toBe(2);
  });

  test("a row stays busy while another action on it runs, past an earlier read", async () => {
    const releases: (() => void)[] = [];
    const h = harness({
      "addons.list": { addons: [addon()] },
      "addons.reinstall": () =>
        new Promise((r) =>
          releases.push(() => r({ addon: addon(), operation: { status: "installed" } })),
        ),
    });
    const { session } = h;
    await session.reloadAddons();
    const first = session.actions.reinstall(addon());
    const second = session.actions.reinstall(addon());
    releases[0]!();
    await new Promise((r) => setTimeout(r, 0));
    expect(session.get().busy).toEqual({ a1: true });
    releases[1]!();
    await Promise.all([first, second]);
    expect(session.get().busy).toEqual({});
  });

  test("actions running together, and what the engine reports meanwhile, read the list once", async () => {
    let reads = 0;
    const releases: (() => void)[] = [];
    const h = harness({
      "addons.list": () => {
        reads++;
        return { addons: [addon({ version: `read ${reads}` })] };
      },
      "addons.install": () =>
        new Promise((r) => {
          // A new addon and its library: ids no row has yet.
          h.session.addonsChanged(["new", "lib"]);
          releases.push(() =>
            r({ addon: addon({ id: "new" }), operation: { status: "installed" } }),
          );
        }),
      "addons.remove": () =>
        new Promise((r) => {
          h.session.addonsChanged(["a1"]);
          releases.push(() => r({}));
        }),
    });
    const { session } = h;
    const install = session.actions.install({
      providerId: "Curse",
      externalId: "1",
      name: "New",
    } as SearchResult);
    const remove = session.actions.remove(addon());
    // An automatic update finishes meanwhile.
    session.addonsChanged(["a2"]);
    releases.forEach((release) => release());
    await Promise.all([install, remove]);
    await Promise.resolve();
    expect(session.get().addons.map((a) => a.version)).toEqual(["read 1"]);
  });

  test("a list read started before an Ignore doesn't bring the row back", async () => {
    let land!: () => void;
    let reads = 0;
    const h = harness({
      "addons.list": () => {
        reads++;
        if (reads === 1) {
          return { addons: [addon()] };
        }
        // Read before the Ignore, answered after it.
        return new Promise((r) => (land = () => r({ addons: [addon()] })));
      },
      "addons.setIgnored": { addon: addon({ ignored: true }) },
    });
    const { session } = h;
    await session.reloadAddons();
    const stale = session.reloadAddons();
    await session.actions.setIgnored(addon(), true);
    land();
    await stale;
    expect(session.get().addons.map((a) => a.ignored)).toEqual([true]);
  });

  test("an addon the engine returns that the list doesn't show yet reads the list", async () => {
    const { session } = harness({
      "addons.list": { addons: [addon({ id: "b1" })] },
      "addons.setIgnored": { addon: addon({ id: "b1", ignored: true }) },
    });
    await session.actions.setIgnored(addon({ id: "b1" }), true);
    await Promise.resolve();
    expect(session.get().addons.map((a) => a.id)).toEqual(["b1"]);
  });

  test("a change the engine reports outside any action re-reads the list", async () => {
    const { session } = harness({ "addons.list": { addons: [addon({ version: "2.0" })] } });
    session.addonsChanged(["a1"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(session.get().addons.map((a) => a.version)).toEqual(["2.0"]);
  });

  test("the folder's dependencies stay on screen; the engine's addon carries none", async () => {
    // The list stub would wipe the change, so a re-read would show.
    const h = harness({
      "addons.list": { addons: [addon({ neededBy: ["Plater"], dependencies: ["Lib"] })] },
      "addons.setIgnored": () => {
        // The engine announces the change before it answers.
        h.session.addonsChanged(["a1"]);
        return { addon: addon({ ignored: true, neededBy: [], dependencies: [] }) };
      },
    });
    const { session } = h;
    await session.reloadAddons();
    await session.actions.setIgnored(session.get().addons[0]!, true);
    await Promise.resolve();
    expect(session.get().addons).toEqual([
      addon({ ignored: true, neededBy: ["Plater"], dependencies: ["Lib"] }),
    ]);
  });

  test("the filter is trimmed; Show ignored is kept", () => {
    const { session } = harness({});
    session.setFilter("  dbm ");
    session.setShowIgnored(true);
    expect(session.get().filter).toBe("dbm");
    expect(session.get().showIgnored).toBe(true);
  });
});

describe("Get Addons results against My Addons' list", () => {
  const ref = { providerId: "Curse", externalId: "61284" };

  test("matched by provider and id, nothing else", () => {
    expect(installedAddonFor([addon()], ref)?.id).toBe("a1");
    expect(installedAddonFor([addon({ providerId: "WowInterface" })], ref)).toBeNull();
    expect(installedAddonFor([addon({ externalId: "1" })], ref)).toBeNull();
  });

  test("not installed: Install, no tags", () => {
    expect(resultTags(null)).toEqual([]);
    expect(resultInstallLabel(null)).toBe("Install");
  });

  test("installed: Installed, X reinstalls", () => {
    expect(resultTags(addon({ canReinstall: true }))).toEqual(["Installed"]);
    expect(resultInstallLabel(addon({ canReinstall: true }))).toBe("Reinstall");
  });

  test("installed and not reinstallable (a direct link, a source off): X does nothing", () => {
    expect(resultTags(addon({ providerId: "Zip", canReinstall: false }))).toEqual(["Installed"]);
    expect(resultInstallLabel(addon({ providerId: "Zip", canReinstall: false }))).toBeNull();
  });

  test("an update waiting: Update available, X updates", () => {
    const outdated = addon({ updateAvailable: true });
    expect(resultTags(outdated)).toEqual(["Update available"]);
    expect(resultInstallLabel(outdated)).toBe("Update");
  });

  test("an ignored addon's update is not offered (as in My Addons)", () => {
    const ignored = addon({ updateAvailable: false, ignored: true, canReinstall: true });
    expect(resultTags(ignored)).toEqual(["Installed"]);
    expect(resultInstallLabel(ignored)).toBe("Reinstall");
  });

  test("recently updated adds Updated", () => {
    expect(resultTags(addon({ newlyUpdated: true }))).toEqual(["Installed", "Updated"]);
  });
});

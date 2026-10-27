/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { Addon, Installation } from "./types";
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

  test("an action's busy flag shows while it runs, and the list reloads after", async () => {
    let release!: () => void;
    const { session, log } = harness({
      "addons.update": () =>
        new Promise(
          (r) => (release = () => r({ addon: addon(), operation: { status: "current" } })),
        ),
      "addons.list": { addons: [] },
    });
    const running = session.actions.update(addon());
    expect(session.get().busy).toEqual({ a1: true });
    release();
    await running;
    await Promise.resolve();
    expect(session.get().busy).toEqual({});
    expect(log).toContain("addons.list");
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

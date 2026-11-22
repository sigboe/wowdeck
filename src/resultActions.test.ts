/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { Addon, Installation, ReleaseChannel, SearchResult } from "./types";
import { createFakeEngine, settle } from "./testSupport/fakeEngine";
import { createAddonSession } from "./addonSession";
import {
  installedActions,
  resultActions,
  type InstalledActionsDeps,
  type ResultActionsDeps,
} from "./resultActions";

const result = {
  providerId: "Curse",
  externalId: "61284",
  name: "Details",
  channelReleases: [
    { channel: "stable", version: "1.0", fileChannel: "stable" },
    { channel: "beta", version: "1.1", fileChannel: "beta" },
  ],
} as unknown as SearchResult;
const installedRow = {
  id: "a1",
  providerId: "Curse",
  externalId: "61284",
  canReinstall: true,
} as Addon;

/**
 * Results and Details both build X and Menu from this, against the session's
 * current state, so one install shows pending in both. Install answers only
 * when the test says; the list holds the addon from the second read on.
 * Installation i1 is active once the test reads the installations.
 */
function views() {
  let answerInstall!: () => void;
  let reads = 0;
  const fake = createFakeEngine({
    "addons.install": () =>
      new Promise(
        (r) =>
          (answerInstall = () =>
            r({
              addon: installedRow,
              operation: { operationId: "op", addonId: "a1", status: "installed", error: null },
            })),
      ),
    "installations.list": { installations: [{ id: "i1", selected: true } as Installation] },
    "installations.recoveryStatus": { installations: [], stateFile: { status: "readable" } },
    "installations.select": { installation: null },
    "addons.list": () => ({ addons: reads++ ? [installedRow] : [] }),
  });
  /** The engine calls so far, as "method" or "method channel". */
  const log = () =>
    fake.calls.map(({ method, params }) => {
      const channel = (params as { channel?: string } | undefined)?.channel;
      return channel ? `${method} ${channel}` : method;
    });
  const session = createAddonSession({
    rpc: fake.rpc,
    toast: () => {},
    toastError: () => {},
    autoUpdateOn: () => false,
  });
  const picks: ((c: ReleaseChannel) => void)[] = [];
  const deps: ResultActionsDeps = {
    actions: session.actions,
    showChannelMenu: (_choices, pick) => picks.push(pick),
  };
  return {
    session,
    log,
    clearLog: () => (fake.calls.length = 0),
    picks,
    current: () => resultActions(session.get(), result, deps),
    answerInstall: () => answerInstall(),
  };
}

describe("Get Addons result actions from the shared session", () => {
  test("an install from a channel menu shows pending in every view", async () => {
    const { session, current, picks, log } = views();
    await session.reloadInstallations();
    await session.reloadAddons();
    const results = current();
    expect(results).toMatchObject({ pending: false, installLabel: "Install" });
    results.channelMenu!();
    picks[0]!("beta");
    // Details opened now, from the same session.
    expect(current()).toMatchObject({ pending: true, installLabel: "Install" });
    // Results' X, captured before the install began, sends nothing.
    await results.onInstall();
    expect(log().filter((l) => l.startsWith("addons.install"))).toEqual(["addons.install beta"]);
  });

  test("after the install, Details' X follows the refreshed state, not the props it opened with", async () => {
    const { session, current, answerInstall, log, clearLog } = views();
    await session.reloadInstallations();
    await session.reloadAddons();
    const install = current().onInstall();
    answerInstall();
    await install;
    expect(current()).toMatchObject({
      pending: false,
      installLabel: "Reinstall",
      tags: ["Installed"],
    });
    clearLog();
    void current().onInstall();
    expect(log()).toEqual(["addons.reinstall"]);
  });

  test("X and a channel pick from before an installation switch send nothing during it", async () => {
    const { session, current, picks, log } = views();
    await session.reloadInstallations();
    await session.reloadAddons();
    const stale = current();
    stale.channelMenu!();
    const switching = session.selectInstallation("i2");
    await stale.onInstall();
    picks[0]!("beta");
    await switching;
    expect(log().filter((l) => l.startsWith("addons.install"))).toEqual([]);
    expect(current()).toMatchObject({ pending: false });
  });

  test("a new install is unavailable while an installation switch is underway", async () => {
    const { session, current } = views();
    await session.reloadInstallations();
    await session.reloadAddons();
    const switching = session.selectInstallation("i2");
    expect(current().installLabel).toBeNull();
    expect(current().channelMenu).toBeUndefined();
    await switching;
    expect(session.get().switching).toBe(false);
    // (This stub's list now holds the addon, so X reads Reinstall.)
    expect(current().channelMenu).toBeDefined();
  });

  test("an installed addon keeps its reinstall during the switch", async () => {
    const { session, current, answerInstall } = views();
    await session.reloadInstallations();
    await session.reloadAddons();
    const install = current().onInstall();
    answerInstall();
    await install;
    const switching = session.selectInstallation("i2");
    expect(current().installLabel).toBe("Reinstall");
    await switching;
  });
});

test("recovery pauses the shared Results and Details actions", async () => {
  const { session, log } = views();
  const actions = resultActions(
    {
      ...session.get(),
      selectedId: "blocked",
      installations: [{ id: "blocked", displayName: "Retail" } as Installation],
      recoveryRequired: { blocked: true },
    },
    result,
    {
      actions: session.actions,
      showChannelMenu: () => {
        throw new Error("must not open");
      },
    },
  );
  expect(actions.installLabel).toBeNull();
  expect(actions.channelMenu).toBeUndefined();
  await actions.onInstall();
  expect(log()).toEqual([]);
});

/** My Addons' Details, over the same fake session: X updates, Menu follows a channel. */
function installedViews() {
  const row = {
    id: "a1",
    name: "Details",
    providerId: "Curse",
    externalId: "61284",
    channel: "stable",
    canChangeChannel: true,
    updateAvailable: true,
    availableVersion: "1.1",
    version: "1.0",
    ignored: false,
    newlyUpdated: false,
  } as Addon;
  const fake = createFakeEngine({
    "installations.list": { installations: [{ id: "i1", selected: true } as Installation] },
    "installations.recoveryStatus": { installations: [], stateFile: { status: "readable" } },
    "addons.list": () => ({ addons: [row] }),
    "addons.update": {
      addon: row,
      operation: { operationId: "op", addonId: "a1", status: "updated", error: null },
    },
    "addons.setChannel": {
      addon: row,
      operation: { operationId: "op", addonId: "a1", status: "installed", error: null },
    },
  });
  const session = createAddonSession({
    rpc: fake.rpc,
    toast: () => {},
    toastError: () => {},
    autoUpdateOn: () => false,
  });
  const menus: { choices: { value: string; label: string }[]; current: string }[] = [];
  const picks: ((c: ReleaseChannel) => void)[] = [];
  const deps: InstalledActionsDeps = {
    actions: session.actions,
    showChannelMenu: (choices, current, pick) => {
      menus.push({ choices, current });
      picks.push(pick);
    },
  };
  const current = (a: Addon = row) => installedActions(session.get(), a, deps);
  /** The engine methods called so far, in order. */
  const methods = () => fake.calls.map((c) => c.method);
  return { session, row, calls: methods, menus, picks, current };
}

describe("an installed addon's Details actions (My Addons)", () => {
  test("X updates when an update is on offer, and says its work while the row is busy", async () => {
    const { session, current, calls } = installedViews();
    await session.reloadInstallations();
    await session.reloadAddons();
    expect(current()).toMatchObject({ installLabel: "Update", pending: false, tags: [] });
    const update = current().onInstall();
    expect(current()).toMatchObject({ pending: true });
    await update;
    expect(calls()).toContain("addons.update");
  });

  test("no update on offer: X does nothing", async () => {
    const { session, row, calls } = installedViews();
    await session.reloadInstallations();
    await session.reloadAddons();
    const actions = installedActions(
      session.get(),
      { ...row, updateAvailable: false },
      {
        actions: session.actions,
        showChannelMenu: () => {},
      },
    );
    expect(actions.installLabel).toBeNull();
    await actions.onInstall();
    expect(calls().filter((m) => m === "addons.update")).toEqual([]);
  });

  test("the channel menu marks the followed channel and installs only another one", async () => {
    const { session, current, calls, menus, picks } = installedViews();
    await session.reloadInstallations();
    await session.reloadAddons();
    current().channelMenu!();
    expect(menus[0]).toEqual({
      choices: [
        { value: "stable", label: "Stable" },
        { value: "beta", label: "Beta" },
        { value: "alpha", label: "Alpha" },
      ],
      current: "stable",
    });
    picks[0]!("beta");
    await settle();
    expect(calls()).toContain("addons.setChannel");
    // The marked channel is already followed: picking it again installs nothing.
    current().channelMenu!();
    picks[1]!("stable");
    await settle();
    expect(calls().filter((m) => m === "addons.setChannel")).toEqual(["addons.setChannel"]);
  });

  test("no channel menu when the addon cannot change channel", async () => {
    const { session, row } = installedViews();
    await session.reloadInstallations();
    await session.reloadAddons();
    const actions = installedActions(
      session.get(),
      { ...row, canChangeChannel: false },
      {
        actions: session.actions,
        showChannelMenu: () => {
          throw new Error("must not open");
        },
      },
    );
    expect(actions.channelMenu).toBeUndefined();
  });

  test("recovery required: neither X nor the channel menu", async () => {
    const { session, row, calls } = installedViews();
    await session.reloadInstallations();
    await session.reloadAddons();
    const actions = installedActions(
      {
        ...session.get(),
        selectedId: "blocked",
        installations: [{ id: "blocked", displayName: "Retail" } as Installation],
        recoveryRequired: { blocked: true },
      },
      row,
      {
        actions: session.actions,
        showChannelMenu: () => {
          throw new Error("must not open");
        },
      },
    );
    expect(actions.installLabel).toBeNull();
    expect(actions.channelMenu).toBeUndefined();
    await actions.onInstall();
    expect(calls().filter((m) => m.startsWith("addons."))).toEqual(["addons.list"]);
  });
});

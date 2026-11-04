/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { Addon, ReleaseChannel, SearchResult } from "./types";
import { createAddonSession, type AddonSessionDeps } from "./addonSession";
import { resultActions, type ResultActionsDeps } from "./resultActions";

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
 */
function views() {
  const log: string[] = [];
  let answerInstall!: () => void;
  let reads = 0;
  const session = createAddonSession({
    rpc: (async (method: string, params?: { channel?: string }): Promise<unknown> => {
      log.push(params?.channel ? `${method} ${params.channel}` : method);
      if (method === "addons.install") {
        return new Promise<unknown>(
          (r) =>
            (answerInstall = () => r({ addon: installedRow, operation: { status: "installed" } })),
        );
      }
      return { addons: reads++ ? [installedRow] : [] };
    }) as unknown as AddonSessionDeps["rpc"],
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
    picks,
    current: () => resultActions(session.get(), result, deps),
    answerInstall: () => answerInstall(),
  };
}

describe("Get Addons result actions from the shared session", () => {
  test("an install from a channel menu shows pending in every view", async () => {
    const { session, current, picks, log } = views();
    await session.reloadAddons();
    const results = current();
    expect(results).toMatchObject({ pending: false, installLabel: "Install" });
    results.channelMenu!();
    picks[0]!("beta");
    // Details opened now, from the same session.
    expect(current()).toMatchObject({ pending: true, installLabel: "Install" });
    // Results' X, captured before the install began, sends nothing.
    await results.onInstall();
    expect(log.filter((l) => l.startsWith("addons.install"))).toEqual(["addons.install beta"]);
  });

  test("after the install, Details' X follows the refreshed state, not the props it opened with", async () => {
    const { session, current, answerInstall, log } = views();
    await session.reloadAddons();
    const install = current().onInstall();
    answerInstall();
    await install;
    expect(current()).toMatchObject({
      pending: false,
      installLabel: "Reinstall",
      tags: ["Installed"],
    });
    log.length = 0;
    void current().onInstall();
    expect(log).toEqual(["addons.reinstall"]);
  });

  test("X and a channel pick from before an installation switch send nothing during it", async () => {
    const { session, current, picks, log } = views();
    await session.reloadAddons();
    const stale = current();
    stale.channelMenu!();
    const switching = session.selectInstallation("i2");
    await stale.onInstall();
    picks[0]!("beta");
    await switching;
    expect(log.filter((l) => l.startsWith("addons.install"))).toEqual([]);
    expect(current()).toMatchObject({ pending: false });
  });

  test("a new install is unavailable while an installation switch is underway", async () => {
    const { session, current } = views();
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
      installations: [{ id: "blocked", displayName: "Retail" } as import("./types").Installation],
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
  expect(log).toEqual([]);
});

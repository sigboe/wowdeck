import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeDeckyUi } from "./testing/fakeDeckyUi";
import type { Addon, Installation, SearchResult } from "./types";
import { createAddonSession } from "./addonSession";
import { connectEngine } from "./engineLink";
import { createFakeEngine } from "./testSupport/fakeEngine";
import { resultActions } from "./resultActions";

/**
 * Install answers only when the test says, and a switch never does; the list
 * holds the addon after the install. The lazy description and changelog
 * reads answer empty.
 */
let answerInstall!: () => void;
const fake = createFakeEngine({
  "addons.install": () =>
    new Promise((resolve) => {
      answerInstall = () =>
        resolve({
          addon: installedRow,
          operation: { operationId: "op", addonId: "a1", status: "installed", error: null },
        });
    }),
  "installations.list": {
    installations: [{ id: "i1", displayName: "Retail", selected: true } as Installation],
  },
  "installations.recoveryStatus": { installations: [], stateFile: { status: "readable" } },
  "addons.list": () => ({ addons: installedNow ? [installedRow] : [] }),
  "addons.getDescription": { description: "" },
  "addons.getChangelog": { changelog: "" },
});
connectEngine(fake);
const rpc = fake.rpc;
let installedNow = false;
const installedRow = {
  id: "a1",
  providerId: "Curse",
  externalId: "61284",
  canReinstall: true,
  updateAvailable: false,
  ignored: false,
  newlyUpdated: false,
} as Addon;

const session = createAddonSession({
  rpc,
  toast: () => {},
  toastError: () => {},
  autoUpdateOn: () => false,
});

mock.module("@decky/ui", () => fakeDeckyUi);
mock.module("./session", () => ({
  addonSession: session,
  activeInstallationId: () => session.get().selectedId ?? "",
}));

const { AddonDetailsModal } = await import("./components/AddonDetailsModal");

const result = {
  providerId: "Curse",
  externalId: "61284",
  name: "Details",
  screenshots: [],
  relationships: [],
  channelReleases: [
    { channel: "stable", version: "1.0", fileChannel: "stable" },
    { channel: "beta", version: "1.1", fileChannel: "beta" },
  ],
} as unknown as SearchResult;

/** The Details modal as Get Addons opens it: following the session through `live`. */
function details() {
  const deps = { actions: session.actions, showChannelMenu: () => {} };
  const live = (state: ReturnType<typeof session.get>) => resultActions(state, result, deps);
  return renderToStaticMarkup(<AddonDetailsModal result={result as never} live={live} />);
}

describe("Details modal follows the shared session", () => {
  test("an install pending elsewhere shows here, and once landed Details offers the installed addon's action", async () => {
    await session.reloadInstallations();
    await session.reloadAddons();
    const idle = details();
    expect(idle).toContain("X: Install");
    expect(idle).not.toContain("Install…");
    expect(idle).toContain("Menu: Release channel");
    expect(idle).not.toContain("Installed");

    // Started from a Results row (here, directly on the session).
    const running = session.actions.install(result);
    const pending = details();
    expect(pending).toContain("X: Install…");
    expect(pending).not.toContain("Menu: Release channel");

    installedNow = true;
    answerInstall();
    await running;
    const landed = details();
    expect(landed).toContain("X: Reinstall");
    expect(landed).toContain("Installed");
    expect(landed).not.toContain("…");
  });

  test("Updated follows the engine state when a newer update is discovered and withdrawn", async () => {
    installedNow = true;
    installedRow.newlyUpdated = true;
    await session.reloadAddons();
    expect(details()).toContain("Updated");
    installedRow.newlyUpdated = false;
    installedRow.updateAvailable = true;
    await session.reloadAddons();
    expect(details()).not.toContain("Updated");
    expect(details()).toContain("Update available");
    installedRow.updateAvailable = false;
    await session.reloadAddons();
    expect(details()).not.toContain("Updated");
  });

  test("a new install is not offered while an installation switch is underway", async () => {
    installedNow = false;
    await session.reloadAddons();
    void session.selectInstallation("i2");
    const html = details();
    expect(html).not.toContain("X:");
    expect(html).not.toContain("Menu: Release channel");
  });
});

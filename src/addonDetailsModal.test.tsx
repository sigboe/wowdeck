import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeDeckyUi } from "./testing/fakeDeckyUi";
import type { Addon, Installation, SearchResult } from "./types";
import { createAddonSession, type AddonSessionDeps } from "./addonSession";
import { resultActions } from "./resultActions";

/** Install and list answer only when the test says; the list holds the addon after the install. */
let answerInstall!: () => void;
const rpc = (async (method: string): Promise<unknown> => {
  if (method === "addons.install") {
    return new Promise<unknown>((resolve) => {
      answerInstall = () => resolve({ addon: installedRow, operation: { status: "installed" } });
    });
  }
  if (method === "installations.select") {
    return new Promise<unknown>(() => {});
  }
  if (method === "installations.list") {
    return { installations: [{ id: "i1", displayName: "Retail", selected: true } as Installation] };
  }
  return { addons: installedNow ? [installedRow] : [] };
}) as unknown as AddonSessionDeps["rpc"];
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
// The lazy description and changelog reads need no engine here.
mock.module("./services/backend", () => ({
  rpc: async () => ({ description: "", changelog: "" }),
}));
mock.module("./session", () => ({ addonSession: session }));

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
  return renderToStaticMarkup(
    <AddonDetailsModal result={result as never} {...live(session.get())} live={live} />,
  );
}

describe("Details modal follows the shared session", () => {
  test("an install pending elsewhere shows here, and once landed Details offers the installed addon's action", async () => {
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

/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { Addon, Installation, SearchResult, UpdateAllProgress } from "./types";
import type {
  AddonOperation,
  MethodMap,
  MethodName,
  OperationResult,
} from "../backend/src/api/contracts";
import {
  catalogueResult,
  createAddonSession,
  recoveryNeededFor,
  stateFileRecoveryFor,
  installedAddonFor,
  installationSwitchBlocked,
  isInstallPending,
  resultInstallLabel,
  resultTags,
  type AddonSessionDeps,
} from "./addonSession";
import { searchDestination } from "./browseDestinations";
import { createFakeEngine, engineFailure, settle, type Answers } from "./testSupport/fakeEngine";
import type { SessionActionId } from "./addonRow";

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

const op = (status: OperationResult["status"], addonId = "a1"): OperationResult => ({
  operationId: "op",
  addonId,
  status,
  error: null,
});

const installation = (id: string, selected = false) => ({ id, selected }) as Installation;

/**
 * A session over the typed fake engine: `answers` answers each method at once
 * (an Error is a failed call); a method without one waits. It starts with
 * installation `active` selected (read before the log begins), or with none
 * when that is null. The log holds the engine calls and the toasts, in order.
 */
async function harness(answers: Answers, active: string | null = "i1") {
  const log: string[] = [];
  const fake = createFakeEngine(
    active === null
      ? answers
      : {
          "installations.list": { installations: [installation(active, true)] },
          "installations.recoveryStatus": engineFailure("not_ready"),
        },
    {},
    log,
  );
  const deps: AddonSessionDeps = {
    rpc: fake.rpc,
    toast: (title, body = "") => log.push(body ? `toast ${title} | ${body}` : `toast ${title}`),
    toastError: (title, e) => log.push(`error ${title} | ${e instanceof Error ? e.message : e}`),
    autoUpdateOn: () => false,
  };
  const session = createAddonSession(deps);
  if (active !== null) {
    await session.reloadInstallations();
    log.length = 0;
    fake.answers = answers;
  }
  return { session, log, fake };
}

describe("addon session: installations", () => {
  test("a result directs the player to find WoW only with no installations", () => {
    expect(resultInstallLabel(null, 0)).toBe("Find WoW install");
    expect(resultInstallLabel(null, 1)).toBe("Install");
  });
  test("an empty Find WoW scan reports the result and can be retried after a failure", async () => {
    const answers: Answers = {
      "installations.detect": new Error("scan failed"),
      "installations.list": { installations: [] },
      "addons.list": { addons: [] },
    };
    const { session } = await harness(answers);
    await session.findWow();
    expect(session.get().findingWow).toBe(false);
    expect(session.get().findWowResult).toContain("Couldn't find WoW");
    answers["installations.detect"] = { installations: [] };
    await session.findWow();
    expect(session.get().findWowResult).toBe("Found 0 installations");
  });

  test("Find WoW stays busy across subscribers and ignores a second scan while pending", async () => {
    let finish!: (value: { installations: Installation[] }) => void;
    const pending = new Promise<{ installations: Installation[] }>((resolve) => {
      finish = resolve;
    });
    const { session, log } = await harness({
      "installations.detect": () => pending,
      "installations.list": { installations: [] },
      "addons.list": { addons: [] },
    });
    const scan = session.findWow();
    expect(session.get().findingWow).toBe(true);
    const off = session.subscribe(() => {});
    off();
    await session.findWow();
    expect(log.filter((line) => line === "installations.detect")).toHaveLength(1);
    finish({ installations: [] });
    await scan;
    expect(session.get().findingWow).toBe(false);
    expect(session.get().findWowResult).toBe("Found 0 installations");
  });

  test("Find WoW detects installations and loads their addons", async () => {
    const { session, log } = await harness({
      "installations.detect": { installations: [installation("i1", true)] },
      "installations.list": { installations: [installation("i1", true)] },
      "addons.list": { addons: [addon()] },
    });
    await session.findWow();
    expect(session.get().installations.map((i) => i.id)).toEqual(["i1"]);
    expect(session.get().addons.map((a) => a.id)).toEqual(["a1"]);
    expect(log).toContain("installations.detect");
    expect(log).toContain("toast Found 1 installation");
    expect(session.get().findingWow).toBe(false);
  });

  test("the engine says which installation is active, not the list order", async () => {
    const { session } = await harness({
      "installations.list": { installations: [installation("i1"), installation("i2", true)] },
      "addons.list": { addons: [addon()] },
    });
    await session.reloadAll();
    expect(session.get().selectedId).toBe("i2");
    expect(session.get().addons.map((a) => a.id)).toEqual(["a1"]);
  });

  test("the list and the provider check name the active installation", async () => {
    const { session, log } = await harness({
      "installations.list": { installations: [installation("i1"), installation("i2", true)] },
      "addons.list": { addons: [addon()] },
      "addons.refresh": { addons: [addon()], updated: 0, failed: 0 },
    });
    await session.reloadAll();
    await session.refreshFromProviders();
    expect(log).toContain('addons.list {"installationId":"i2"}');
    expect(log).toContain('addons.refresh {"installationId":"i2"}');
  });

  test("with no installation the list is empty and the engine isn't asked for it", async () => {
    const { session, log } = await harness({ "installations.list": { installations: [] } }, null);
    await session.reloadAll();
    expect(session.get().addons).toEqual([]);
    expect(log.filter((l) => l.startsWith("addons.") || l.startsWith("error"))).toEqual([]);
  });

  test("switching selects in the engine first, then resets the list and Get Addons", async () => {
    const { session, log } = await harness({
      "installations.select": { installation: null },
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
    expect(log).toEqual([
      'installations.select {"installationId":"i2"}',
      'addons.list {"installationId":"i2"}',
    ]);
    expect(listDuringReload!).toEqual([]);
    expect(session.get().selectedId).toBe("i2");
    expect(session.get().addons.map((a) => a.id)).toEqual(["b1"]);
    expect(searchDestination.get()).toMatchObject({ query: "", results: null });
  });

  test("a failed switch keeps the list and re-reads the installations", async () => {
    let selectFails = false;
    const { session, log } = await harness({
      "installations.list": { installations: [installation("i1", true)] },
      "addons.list": { addons: [addon()] },
      "installations.select": () => {
        if (selectFails) {
          throw new Error("no such installation");
        }
        return { installation: null };
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
      "installations.recoveryStatus",
      "installations.list",
    ]);
    expect(session.get().selectedId).toBe("i1");
    expect(session.get().addons.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("addon session: installation writes", () => {
  test("updateInstallation sends the changes, reads the installations again and answers with it", async () => {
    const { session, log } = await harness({
      "installations.update": { installation: installation("i1", true) },
      "installations.list": { installations: [installation("i1", true)] },
      "installations.recoveryStatus": { installations: [], stateFile: { status: "readable" } },
    });
    const changed = await session.updateInstallation("i1", { hidden: true });
    expect(changed.id).toBe("i1");
    expect(log).toContain('installations.update {"installationId":"i1","hidden":true}');
    expect(log).toContain("installations.list");
  });

  test("removeInstallation removes, then reads the installations again", async () => {
    const { session, log } = await harness({
      "installations.remove": { installationId: "i1" },
      "installations.list": { installations: [] },
      "installations.recoveryStatus": { installations: [], stateFile: { status: "readable" } },
    });
    await session.removeInstallation("i1");
    expect(log).toEqual([
      'installations.remove {"installationId":"i1"}',
      "installations.recoveryStatus",
      "installations.list",
    ]);
    expect(session.get().selectedId).toBeNull();
  });

  test("addInstallation adds, reads both lists again and answers with the folder's installations", async () => {
    const { session, log } = await harness({
      "installations.add": { installations: [installation("i2")] },
      "installations.list": { installations: [installation("i1", true), installation("i2")] },
      "addons.list": { addons: [addon()] },
      "installations.recoveryStatus": { installations: [], stateFile: { status: "readable" } },
    });
    const added = await session.addInstallation({ path: "/games/wow" });
    expect(added.map((i) => i.id)).toEqual(["i2"]);
    expect(log).toContain('installations.add {"path":"/games/wow"}');
    expect(session.get().installations.map((i) => i.id)).toEqual(["i1", "i2"]);
    expect(log).toContain('addons.list {"installationId":"i1"}');
  });

  test("rescanInstallation refreshes that installation and toasts what it couldn't check", async () => {
    const { session, log } = await harness({
      "addons.refresh": { addons: [addon({ version: "2" })], updated: 1, failed: 2 },
    });
    const outcome = await session.rescanInstallation("i1");
    expect(outcome).toBe("refreshed");
    expect(log).toContain('addons.refresh {"installationId":"i1"}');
    expect(session.get().addons[0]!.version).toBe("2");
    expect(log).toContain("toast Couldn't check 2 addons for updates | Try again later");
  });

  test("rescanning a recovery-required installation shows the recovery state, not an error", async () => {
    const { session, log } = await harness({
      "installations.list": { installations: [installation("i1", true)] },
      "installations.recoveryStatus": {
        installations: [{ installationId: "i1", status: "recoveryRequired" }],
        stateFile: { status: "readable" },
      },
      "addons.list": { addons: [addon()], unverified: true },
    });
    await session.reloadAll();
    expect(recoveryNeededFor(session.get())?.id).toBe("i1");
    log.length = 0;
    const outcome = await session.rescanInstallation("i1");
    expect(outcome).toBe("recovery");
    // No provider refresh was attempted and no error toasted: the engine
    // refuses it there; the recovery state is what shows.
    expect(log.filter((l) => l.startsWith("addons.refresh"))).toEqual([]);
    expect(log.filter((l) => l.startsWith("error"))).toEqual([]);
    expect(recoveryNeededFor(session.get())?.id).toBe("i1");
  });

  test("rescanning another installation refreshes it without replacing the shown list", async () => {
    const { session, log } = await harness({
      "installations.list": { installations: [installation("i1", true), installation("i2")] },
      "addons.list": { addons: [addon()] },
      "addons.refresh": { addons: [addon({ id: "b1" })], updated: 0, failed: 0 },
    });
    await session.reloadAll();
    log.length = 0;
    await session.rescanInstallation("i2");
    expect(log).toContain('addons.refresh {"installationId":"i2"}');
    expect(session.get().addons.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("addon session: installs started elsewhere", () => {
  test("holds installation switching while it runs, then reads the list again", async () => {
    const { session, log } = await harness({
      "addons.list": { addons: [addon({ id: "new" })] },
    });
    let finish!: () => void;
    const running = new Promise<void>((resolve) => (finish = resolve));
    let settled = false;
    const call = session
      .installElsewhere("i1", () => running)
      .then(() => {
        settled = true;
      });
    expect(installationSwitchBlocked(session.get())).toBe("Wait for addon installs to finish.");
    finish();
    await call;
    expect(settled).toBe(true);
    expect(installationSwitchBlocked(session.get())).toBeNull();
    expect(log).toContain('addons.list {"installationId":"i1"}');
    expect(session.get().addons.map((a) => a.id)).toEqual(["new"]);
  });

  test("reads the recovery state again when the install's answer says recovery required", async () => {
    const { session, log } = await harness({
      "installations.recoveryStatus": {
        installations: [{ installationId: "i1", status: "recoveryRequired" }],
        stateFile: { status: "readable" },
      },
      "addons.list": { addons: [] },
    });
    const operation = { ...op("failed"), recoveryRequired: true };
    await session.installElsewhere("i1", () => Promise.resolve({ operation }));
    expect(log).toContain("installations.recoveryStatus");
    expect(recoveryNeededFor(session.get())?.id).toBe("i1");
  });

  test("an install the engine refuses for recovery rethrows and reads the recovery state", async () => {
    const { session, log } = await harness({
      "installations.recoveryStatus": { installations: [], stateFile: { status: "readable" } },
      "addons.list": { addons: [] },
    });
    let refused: unknown = null;
    try {
      await session.installElsewhere("i1", () => Promise.reject({ code: "recovery_required" }));
    } catch (e) {
      refused = e;
    }
    expect((refused as { code?: string }).code).toBe("recovery_required");
    expect(log).toContain("installations.recoveryStatus");
    expect(installationSwitchBlocked(session.get())).toBeNull();
  });

  test("a rejected install rethrows, releases the switch and still reads the list", async () => {
    const { session, log } = await harness({
      "addons.list": { addons: [] },
    });
    const boom = new Error("engine down");
    await expect(session.installElsewhere("i1", () => Promise.reject(boom))).rejects.toBe(boom);
    expect(installationSwitchBlocked(session.get())).toBeNull();
    expect(log.filter((l) => l.startsWith("error"))).toEqual([]);
    expect(log).toContain('addons.list {"installationId":"i1"}');
  });

  test("an install into another installation doesn't re-read the shown list", async () => {
    const { session, log } = await harness({
      "installations.list": { installations: [installation("i1", true), installation("i2")] },
      "addons.list": { addons: [addon()] },
    });
    await session.reloadAll();
    log.length = 0;
    await session.installElsewhere("i2", () => Promise.resolve(null));
    expect(log).toEqual([]);
  });
});

describe("addon session: list reads", () => {
  test("a failed reload keeps the last list and says so", async () => {
    let fail = false;
    const { session, log } = await harness({
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
    const { session, log } = await harness({
      "addons.refresh": { addons: [addon()], updated: 0, failed: 2 },
    });
    await session.refreshFromProviders();
    expect(session.get().addons).toHaveLength(1);
    expect(log).toContain("toast Couldn't check 2 addons for updates | Try again later");
  });

  test("an update shows busy while it runs, then the list's Updated row", async () => {
    let release!: () => void;
    let reads = 0;
    const h = await harness({
      // Each read says which it was, so the list shows how often it was read.
      "addons.list": () => {
        reads++;
        return { addons: [addon({ version: `read ${reads}`, newlyUpdated: reads > 1 })] };
      },
      "addons.update": () =>
        new Promise((r) => {
          h.session.addonsChanged(["a1"]);
          release = () => r({ addon: addon(), operation: op("updated") });
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
    const h = await harness({
      "addons.list": () => {
        reads++;
        return { addons: reads > 0 ? [addon({ id: "new" })] : [] };
      },
      "addons.install": { addon: addon({ id: "new" }), operation: op("installed") },
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
        barDuringRead = session.get().updatingAll?.scope ?? null;
      }
    });
    await session.actions.updateAll("installation");
    expect(barDuringRead!).toBe("installation");
    expect(session.get().updatingAll).toBeNull();
    expect(reads).toBe(2);
  });

  test("Update all progress: checking until the engine counts, then each step, cleared when the run ends (#253)", async () => {
    const step = (done: number, total: number, addonName: string | null): UpdateAllProgress => ({
      done,
      total,
      failed: 0,
      addonName,
    });
    let finish!: (value: { operations: [] }) => void;
    const { session } = await harness({
      "addons.list": { addons: [] },
      "addons.updateAll": () => new Promise((resolve) => (finish = resolve)),
    });
    // No run going: ignored.
    session.updateAllProgress(step(0, 3, "Bagnon"));
    expect(session.get().updatingAll).toBeNull();

    const run = session.actions.updateAll("all");
    expect(session.get().updatingAll).toEqual({ scope: "all", progress: null });
    session.updateAllProgress(step(0, 3, "Bagnon"));
    session.updateAllProgress(step(1, 3, "Details"));
    expect(session.get().updatingAll).toEqual({
      scope: "all",
      progress: step(1, 3, "Details"),
    });

    finish({ operations: [] });
    await run;
    expect(session.get().updatingAll).toBeNull();
    // A late event from the finished run doesn't bring the bar back.
    session.updateAllProgress(step(3, 3, null));
    expect(session.get().updatingAll).toBeNull();
  });

  test("Update all runs once at a time: a second press, from any view, starts nothing (#252)", async () => {
    let finish!: (value: { operations: [] }) => void;
    const { session, fake } = await harness({
      "addons.list": { addons: [] },
      "addons.updateAll": () => new Promise((resolve) => (finish = resolve)),
    });
    const run = session.actions.updateAll("all");
    session.updateAllProgress({ done: 1, total: 3, failed: 0, addonName: "Details" });
    // My Addons' ≡ or this installation's Update all while the band's run goes on.
    await session.actions.updateAll("installation");
    await session.actions.updateAll("all");
    expect(fake.paramsOf("addons.updateAll")).toEqual([{ allInstallations: true }]);
    expect(session.get().updatingAll).toEqual({
      scope: "all",
      progress: { done: 1, total: 3, failed: 0, addonName: "Details" },
    });
    finish({ operations: [] });
    await run;
    expect(session.get().updatingAll).toBeNull();
    // Once it has ended, Update all starts again.
    fake.answers["addons.updateAll"] = { operations: [] };
    await session.actions.updateAll("installation");
    expect(fake.paramsOf("addons.updateAll")).toHaveLength(2);
  });

  test("Update all's progress stays until the update summary has been read again (#252)", async () => {
    const seen: string[] = [];
    const log: string[] = [];
    const fake = createFakeEngine(
      {
        "installations.list": { installations: [installation("i1", true)] },
        "installations.recoveryStatus": engineFailure("not_ready"),
        "addons.list": { addons: [] },
        "addons.updateAll": new Error("engine went away"),
      },
      {},
      log,
    );
    const session = createAddonSession({
      rpc: fake.rpc,
      toast: () => {},
      toastError: (title) => seen.push(`error ${title}`),
      autoUpdateOn: () => false,
      afterUpdateAll: async () => {
        seen.push(`summary ${session.get().updatingAll?.scope ?? "cleared"}`);
      },
    });
    await session.reloadInstallations();
    await session.actions.updateAll("all");
    // A failed run too: its error, then the summary while the bar still shows.
    expect(seen).toEqual(["error Couldn't update addons", "summary all"]);
    expect(session.get().updatingAll).toBeNull();
  });

  test("a row stays busy while another action on it runs, past an earlier read", async () => {
    const releases: (() => void)[] = [];
    const h = await harness({
      "addons.list": { addons: [addon()] },
      "addons.reinstall": () =>
        new Promise((r) => releases.push(() => r({ addon: addon(), operation: op("installed") }))),
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
    const h = await harness({
      "addons.list": () => {
        reads++;
        return { addons: [addon({ version: `read ${reads}` })] };
      },
      "addons.install": () =>
        new Promise((r) => {
          // A new addon and its library: ids no row has yet.
          h.session.addonsChanged(["new", "lib"]);
          releases.push(() => r({ addon: addon({ id: "new" }), operation: op("installed") }));
        }),
      "addons.remove": () =>
        new Promise((r) => {
          h.session.addonsChanged(["a1"]);
          releases.push(() => r({ addonId: "a1", operation: op("removed") }));
        }),
    });
    const { session } = h;
    const install = session.actions.install({
      providerId: "Curse",
      externalId: "1",
      name: "New",
    } as SearchResult);
    const remove = session.actions.remove(addon(), false);
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
    const h = await harness({
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
    const { session } = await harness({
      "addons.list": { addons: [addon({ id: "b1" })] },
      "addons.setIgnored": { addon: addon({ id: "b1", ignored: true }) },
    });
    await session.actions.setIgnored(addon({ id: "b1" }), true);
    await Promise.resolve();
    expect(session.get().addons.map((a) => a.id)).toEqual(["b1"]);
  });

  test("a change the engine reports outside any action re-reads the list", async () => {
    const { session } = await harness({ "addons.list": { addons: [addon({ version: "2.0" })] } });
    session.addonsChanged(["a1"]);
    await settle();
    expect(session.get().addons.map((a) => a.version)).toEqual(["2.0"]);
  });

  test("an action's answer is the row as the engine lists it, taking its place whole", async () => {
    // The list stub would wipe the change, so a re-read would show.
    const h = await harness({
      "addons.list": {
        addons: [addon({ neededBy: ["Plater"], dependencies: ["Lib"], gameVersion: "11.0.2" })],
      },
      "addons.setIgnored": () => {
        // The engine announces the change before it answers.
        h.session.addonsChanged(["a1"]);
        return {
          addon: addon({
            ignored: true,
            neededBy: [],
            dependencies: ["OtherLib"],
            gameVersion: "11.0.7",
          }),
        };
      },
    });
    const { session } = h;
    await session.reloadAddons();
    await session.actions.setIgnored(session.get().addons[0]!, true);
    await Promise.resolve();
    expect(session.get().addons).toEqual([
      addon({ ignored: true, neededBy: [], dependencies: ["OtherLib"], gameVersion: "11.0.7" }),
    ]);
  });

  test("the filter is trimmed; Show ignored is kept", async () => {
    const { session } = await harness({});
    session.setFilter("  dbm ");
    session.setShowIgnored(true);
    expect(session.get().filter).toBe("dbm");
    expect(session.get().showIgnored).toBe(true);
  });
});

describe("addon session: row actions by id", () => {
  /**
   * What each UI-free action id must send: the engine call the row's action
   * stands for. Wiring the dispatch wrong (say "resume auto-update" to the
   * ignore call) fails here, where the view's old switch passed every test.
   */
  const expected: [SessionActionId, string][] = [
    ["update", 'addons.update {"addonId":"a1"}'],
    ["reinstall", 'addons.reinstall {"addonId":"a1"}'],
    ["rollback", 'addons.rollback {"addonId":"a1"}'],
    ["pauseAuto", 'addons.setAutoUpdatePaused {"addonId":"a1","paused":true}'],
    ["resumeAuto", 'addons.setAutoUpdatePaused {"addonId":"a1","paused":false}'],
    ["ignore", 'addons.setIgnored {"addonId":"a1","ignored":true}'],
    ["unignore", 'addons.setIgnored {"addonId":"a1","ignored":false}'],
  ];

  /** Waits until no action runs and no list read is under way. */
  const idle = async (session: ReturnType<typeof createAddonSession>) => {
    for (let i = 0; i < 50; i++) {
      const { loads, busy } = session.get();
      if (loads === 0 && Object.keys(busy).length === 0) {
        return;
      }
      await settle();
    }
  };

  for (const [action, call] of expected) {
    test(`"${action}" sends ${call.slice(0, call.indexOf(" "))}`, async () => {
      const { session, log } = await harness({
        "addons.list": { addons: [addon()] },
        "addons.update": { addon: addon(), operation: op("updated") },
        "addons.reinstall": { addon: addon(), operation: op("installed") },
        "addons.rollback": { addon: addon(), operation: op("installed") },
        "addons.setAutoUpdatePaused": { addon: addon() },
        "addons.setIgnored": { addon: addon() },
      });
      session.run(addon(), action);
      await idle(session);
      expect(log[0]).toBe(call);
    });
  }
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

  test("a cleared Updated status stays absent after the offered update disappears", () => {
    expect(resultTags(addon({ newlyUpdated: false, updateAvailable: true }))).toEqual([
      "Update available",
    ]);
    expect(resultTags(addon({ newlyUpdated: false, updateAvailable: false }))).toEqual([
      "Installed",
    ]);
  });

  test("recently updated adds Updated", () => {
    expect(resultTags(addon({ newlyUpdated: true }))).toEqual(["Installed", "Updated"]);
  });
});

describe("addon session: recovery required (#107)", () => {
  const a = { ...installation("A", true), displayName: "Retail" } as Installation;
  const b = { ...installation("B"), displayName: "Classic" } as Installation;
  const status = (required: string[]) => ({
    installations: ["A", "B"].map((id) => ({
      installationId: id,
      status: required.includes(id) ? ("recoveryRequired" as const) : ("ready" as const),
    })),
    stateFile: { status: "readable" as const },
  });

  test("the engine's recovery status names the active installation for every subscriber", async () => {
    const { session } = await harness({
      "installations.list": { installations: [a, b] },
      "installations.recoveryStatus": status(["A"]),
      "addons.list": { addons: [addon()], unverified: true },
    });
    const seen: (Installation | null)[] = [];
    session.subscribe(() => seen.push(recoveryNeededFor(session.get())));
    session.subscribe(() => {});
    await session.reloadAll();
    expect(recoveryNeededFor(session.get())?.displayName).toBe("Retail");
    expect(seen[seen.length - 1]?.displayName).toBe("Retail");
    expect(session.get().addonsUnverified).toBe(true);
    expect(session.get().addons.map((x) => x.id)).toEqual(["a1"]);
  });

  test("a new session over the same engine (a plugin reload) shows it again", async () => {
    const answers: Answers = {
      "installations.list": { installations: [a, b] },
      "installations.recoveryStatus": status(["A"]),
      "addons.list": { addons: [], unverified: true },
    };
    await (await harness(answers)).session.reloadAll();
    const { session } = await harness(answers);
    await session.reloadAll();
    expect(recoveryNeededFor(session.get())?.id).toBe("A");
  });

  test("switching to an unaffected installation shows none, with a verified list", async () => {
    const answers: Answers = {
      "installations.list": { installations: [a, b] },
      "installations.recoveryStatus": status(["A"]),
      "addons.list": { addons: [], unverified: true },
      "installations.select": { installation: null },
    };
    const { session } = await harness(answers);
    await session.reloadAll();
    answers["addons.list"] = { addons: [addon()] };
    await session.selectInstallation("B");
    expect(recoveryNeededFor(session.get())).toBeNull();
    expect(session.get().addonsUnverified).toBe(false);
  });

  test("an unreadable state file shows for every subscriber with no installation listed", async () => {
    const stateFile = {
      status: "unreadable" as const,
      reason: "WoWDeck Addon Manager can't read its saved state file",
      nextStep: "Repair or restore state.json, then restart Steam",
    };
    const { session } = await harness({
      "installations.list": { installations: [] },
      "installations.recoveryStatus": { installations: [], stateFile },
      "addons.list": { addons: [] },
    });
    const seen: unknown[] = [];
    session.subscribe(() => seen.push(stateFileRecoveryFor(session.get())));
    await session.reloadAll();
    expect(stateFileRecoveryFor(session.get())).toEqual({
      reason: stateFile.reason,
      nextStep: stateFile.nextStep,
    });
    expect(seen[seen.length - 1]).toEqual({
      reason: stateFile.reason,
      nextStep: stateFile.nextStep,
    });
    expect(recoveryNeededFor(session.get())).toBeNull();
  });

  test("a readable state file (or an older engine that doesn't say) shows none", async () => {
    const { session } = await harness({
      "installations.list": { installations: [a, b] },
      "installations.recoveryStatus": status([]),
      "addons.list": { addons: [] },
    });
    await session.reloadAll();
    expect(stateFileRecoveryFor(session.get())).toBeNull();
  });

  test("an unverified list marks its installation even before the status is read again", async () => {
    const { session } = await harness({
      "installations.list": { installations: [a, b] },
      "installations.recoveryStatus": status([]),
      "addons.list": { addons: [], unverified: true },
    });
    await session.reloadAll();
    expect(recoveryNeededFor(session.get())?.id).toBe("A");
  });

  test("an operation that leaves recovery required reads the status again", async () => {
    const answers: Answers = {
      "installations.list": { installations: [a, b] },
      "installations.recoveryStatus": status([]),
      "addons.list": { addons: [addon()] },
      "addons.update": {
        addon: addon(),
        operation: {
          ...op("failed"),
          error: "Couldn't put the addon's files back",
          recoveryRequired: true,
        },
      },
    };
    const { session } = await harness(answers);
    await session.reloadAll();
    expect(recoveryNeededFor(session.get())).toBeNull();
    answers["installations.recoveryStatus"] = status(["A"]);
    await session.actions.update(addon());
    expect(recoveryNeededFor(session.get())?.id).toBe("A");
  });

  test("a removal whose orphaned library left recovery required reads the status again (#110)", async () => {
    const answers: Answers = {
      "installations.list": { installations: [a, b] },
      "installations.recoveryStatus": status([]),
      "addons.list": { addons: [addon()] },
      "addons.remove": {
        addonId: addon().id,
        operation: {
          ...op("removed"),
          followUps: [{ ...op("failed"), error: "stopped", recoveryRequired: true }],
        },
      },
    };
    const { session } = await harness(answers);
    await session.reloadAll();
    answers["installations.recoveryStatus"] = status(["A"]);
    await session.actions.remove(addon(), false);
    expect(recoveryNeededFor(session.get())?.id).toBe("A");
  });

  test("a refused call (recovery_required) reads the status again", async () => {
    const refused = Object.assign(new Error("Retail needs recovery first"), {
      code: "recovery_required",
    });
    const answers: Answers = {
      "installations.list": { installations: [a, b] },
      "installations.recoveryStatus": status([]),
      "addons.list": { addons: [addon()] },
      "addons.setIgnored": refused,
    };
    const { session } = await harness(answers);
    await session.reloadAll();
    answers["installations.recoveryStatus"] = status(["A"]);
    await session.actions.setIgnored(addon(), true);
    expect(recoveryNeededFor(session.get())?.id).toBe("A");
  });

  test("checking for updates there reads the stored list instead of asking providers", async () => {
    const { session, log } = await harness({
      "installations.list": { installations: [a, b] },
      "installations.recoveryStatus": status(["A"]),
      "addons.list": { addons: [addon()], unverified: true },
    });
    await session.reloadAll();
    log.length = 0;
    await session.refreshFromProviders();
    // The stored list, plus the recovery state read again so the notice
    // is current; no provider call.
    expect(log).toEqual(['addons.list {"installationId":"A"}', "installations.recoveryStatus"]);
  });

  test("a status that can't be read keeps the last one", async () => {
    const answers: Answers = {
      "installations.list": { installations: [a, b] },
      "installations.recoveryStatus": status(["A"]),
      "addons.list": { addons: [] },
    };
    const { session } = await harness(answers);
    await session.reloadInstallations();
    answers["installations.recoveryStatus"] = new Error("engine busy");
    await session.reloadInstallations();
    expect(recoveryNeededFor(session.get())?.id).toBe("A");
  });
});

describe("addon session: Retry recovery (#108)", () => {
  const a = { ...installation("A", true), displayName: "Retail" } as Installation;
  const status = (required: string[]) => ({
    installations: [
      {
        installationId: "A",
        status: required.includes("A") ? ("recoveryRequired" as const) : ("ready" as const),
      },
    ],
    stateFile: { status: "readable" as const },
  });

  test("a recovered installation drops the notice for every subscriber and reads a verified list", async () => {
    const answers: Answers = {
      "installations.list": { installations: [a] },
      "installations.recoveryStatus": status(["A"]),
      "addons.list": { addons: [addon()], unverified: true },
      "installations.retryRecovery": {
        installationId: "A",
        status: "recovered",
        restored: ["Suite"],
      },
    };
    const { session, log } = await harness(answers);
    await session.reloadAll();
    expect(recoveryNeededFor(session.get())?.id).toBe("A");
    const seen: (string | null)[] = [];
    session.subscribe(() => seen.push(recoveryNeededFor(session.get())?.id ?? null));
    answers["installations.recoveryStatus"] = status([]);
    answers["addons.list"] = { addons: [addon()] };
    log.length = 0;

    const result = await session.retryRecovery("A");

    expect(result?.status).toBe("recovered");
    expect(log).toContain('installations.retryRecovery {"installationId":"A"}');
    expect(log).toContain("toast Recovered Retail | Suite put back. Addon changes work again.");
    expect(recoveryNeededFor(session.get())).toBeNull();
    expect(seen[seen.length - 1]).toBeNull();
    expect(session.get().addonsUnverified).toBe(false);
  });

  test("a refused retry keeps the notice and returns the engine's explanation", async () => {
    const refused = {
      installationId: "A",
      status: "refused" as const,
      restored: [],
      reason: "Files changed since the addon change stopped",
      nextStep: "Put the files listed here back as they were, then try again",
      conflicts: [
        { location: "AddOns/Suite", reason: "Its files changed since the addon change stopped." },
      ],
    };
    const { session, log } = await harness({
      "installations.list": { installations: [a] },
      "installations.recoveryStatus": status(["A"]),
      "addons.list": { addons: [], unverified: true },
      "installations.retryRecovery": refused,
    });
    await session.reloadAll();

    expect(await session.retryRecovery("A")).toEqual(refused as never);
    expect(recoveryNeededFor(session.get())?.id).toBe("A");
    expect(log.filter((l) => l.startsWith("toast"))).toEqual([]);
  });

  test("a retry the engine can't answer says so and returns nothing", async () => {
    const { session, log } = await harness({
      "installations.list": { installations: [a] },
      "installations.recoveryStatus": status(["A"]),
      "addons.list": { addons: [] },
      "installations.retryRecovery": new Error("engine busy"),
    });
    await session.reloadAll();
    expect(await session.retryRecovery("A")).toBeNull();
    expect(log).toContain("error Couldn't retry recovery | engine busy");
    expect(recoveryNeededFor(session.get())?.id).toBe("A");
  });
});

describe("addon session: Verify recovery (#109)", () => {
  const a = { ...installation("A", true), displayName: "Retail" } as Installation;
  const status = (required: string[]) => ({
    installations: [
      {
        installationId: "A",
        status: required.includes("A") ? ("recoveryRequired" as const) : ("ready" as const),
      },
    ],
    stateFile: { status: "readable" as const },
  });

  test("a verified installation drops the notice and reads a verified list", async () => {
    const answers: Answers = {
      "installations.list": { installations: [a] },
      "installations.recoveryStatus": status(["A"]),
      "addons.list": { addons: [addon()], unverified: true },
      "installations.verifyRecovery": {
        installationId: "A",
        status: "verified",
        verified: ["Suite"],
      },
    };
    const { session, log } = await harness(answers);
    await session.reloadAll();
    answers["installations.recoveryStatus"] = status([]);
    answers["addons.list"] = { addons: [addon()] };
    log.length = 0;

    const result = await session.verifyRecovery("A");

    expect(result?.status).toBe("verified");
    expect(log).toContain('installations.verifyRecovery {"installationId":"A"}');
    expect(log).toContain(
      "toast Verified the repair of Retail | Suite checked. Addon changes work again.",
    );
    expect(recoveryNeededFor(session.get())).toBeNull();
    expect(session.get().addonsUnverified).toBe(false);
  });

  test("a refused verification keeps the notice and returns what still differs", async () => {
    const refused = {
      installationId: "A",
      status: "refused" as const,
      verified: [],
      reason: "The original files aren't all back yet",
      nextStep: "Put the original files back, then verify again",
      conflicts: [{ location: "AddOns/Suite", reason: "Its files differ from the original." }],
    };
    const { session, log } = await harness({
      "installations.list": { installations: [a] },
      "installations.recoveryStatus": status(["A"]),
      "addons.list": { addons: [], unverified: true },
      "installations.verifyRecovery": refused,
    });
    await session.reloadAll();

    expect(await session.verifyRecovery("A")).toEqual(refused as never);
    expect(recoveryNeededFor(session.get())?.id).toBe("A");
    expect(log.filter((l) => l.startsWith("toast"))).toEqual([]);
  });

  test("a verification the engine can't answer says so and returns nothing", async () => {
    const { session, log } = await harness({
      "installations.list": { installations: [a] },
      "installations.recoveryStatus": status(["A"]),
      "addons.list": { addons: [] },
      "installations.verifyRecovery": new Error("engine busy"),
    });
    await session.reloadAll();
    expect(await session.verifyRecovery("A")).toBeNull();
    expect(log).toContain("error Couldn't verify recovery | engine busy");
  });
});

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every settled promise run its continuations. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("addon session: pending catalogue installs", () => {
  const result = (externalId: string, name = `Addon ${externalId}`) =>
    ({ providerId: "Curse", externalId, name }) as SearchResult;
  const installed = (r: SearchResult) =>
    addon({ id: `id-${r.externalId}`, providerId: r.providerId, externalId: r.externalId });
  const installs = (log: string[]) => log.filter((line) => line.startsWith("addons.install"));

  /** A session whose install and list RPCs answer only when the test says. */
  async function deferredHarness() {
    const installAnswers: ReturnType<typeof deferred<AddonOperation>>[] = [];
    const listAnswers: ReturnType<typeof deferred<{ addons: Addon[] }>>[] = [];
    const h = await harness({
      "addons.install": () => {
        const d = deferred<AddonOperation>();
        installAnswers.push(d);
        return d.promise;
      },
      "addons.list": () => {
        const d = deferred<{ addons: Addon[] }>();
        listAnswers.push(d);
        return d.promise;
      },
    });
    return { ...h, installAnswers, listAnswers };
  }
  const ok = { addon: addon(), operation: op("installed") };

  test("pending from before the RPC, across subscribers, until the list read lands", async () => {
    const { session, log, installAnswers, listAnswers } = await deferredHarness();
    const r = result("1");
    const running = session.actions.install(r, "beta");
    expect(installs(log)).toHaveLength(1);
    expect(isInstallPending(session.get(), r)).toBe(true);
    expect(catalogueResult(session.get(), r)).toMatchObject({
      pending: true,
      installLabel: "Install",
    });
    // A view closing and another opening (Details, a remounted QAM).
    session.subscribe(() => {})();
    const off = session.subscribe(() => {});
    expect(isInstallPending(session.get(), r)).toBe(true);
    installAnswers[0]!.resolve(ok);
    await flush();
    // The install answered; the list read that shows it is still out.
    expect(listAnswers).toHaveLength(1);
    expect(isInstallPending(session.get(), r)).toBe(true);
    listAnswers[0]!.resolve({ addons: [installed(r)] });
    await running;
    off();
    expect(isInstallPending(session.get(), r)).toBe(false);
    expect(catalogueResult(session.get(), r)).toMatchObject({
      pending: false,
      installed: { id: "id-1" },
      tags: ["Installed"],
    });
  });

  test("the same addon again, from any view or channel, sends nothing and queues nothing", async () => {
    const { session, log, installAnswers, listAnswers } = await deferredHarness();
    const r = result("1");
    const first = session.actions.install(r);
    await session.actions.install({ ...r }, "beta");
    await session.actions.install(r, "alpha");
    expect(installs(log)).toEqual([
      'addons.install {"installationId":"i1","providerId":"Curse","externalId":"1"}',
    ]);
    installAnswers[0]!.resolve(ok);
    await flush();
    listAnswers[0]!.resolve({ addons: [installed(r)] });
    await first;
    await flush();
    expect(installs(log)).toHaveLength(1);
    expect(listAnswers).toHaveLength(1);
  });

  test("two addons pending at once settle independently", async () => {
    const { session, log, installAnswers, listAnswers } = await deferredHarness();
    const a = result("1");
    const b = result("2");
    const first = session.actions.install(a);
    const second = session.actions.install(b);
    expect(installs(log)).toHaveLength(2);
    installAnswers[0]!.resolve({ addon: addon(), operation: { ...op("failed"), error: "nope" } });
    await first;
    expect(isInstallPending(session.get(), a)).toBe(false);
    expect(isInstallPending(session.get(), b)).toBe(true);
    installAnswers[1]!.resolve(ok);
    await flush();
    listAnswers[0]!.resolve({ addons: [installed(b)] });
    await second;
    expect(isInstallPending(session.get(), b)).toBe(false);
  });

  test("one install succeeding first leaves the other pending until both settle", async () => {
    const { session, log, installAnswers, listAnswers } = await deferredHarness();
    const a = result("1");
    const b = result("2");
    const first = session.actions.install(a);
    const second = session.actions.install(b);
    installAnswers[0]!.resolve(ok);
    await flush();
    // B's install is still out: B stays pending, and A's completion did not clear it.
    expect(isInstallPending(session.get(), b)).toBe(true);
    expect(installationSwitchBlocked(session.get())).not.toBeNull();
    expect(installs(log)).toHaveLength(2);
    // A second B install is still refused.
    await session.actions.install(b, "beta");
    expect(installs(log)).toHaveLength(2);
    installAnswers[1]!.resolve(ok);
    await flush();
    expect(listAnswers).toHaveLength(1);
    expect(isInstallPending(session.get(), b)).toBe(true);
    listAnswers[0]!.resolve({ addons: [installed(a), installed(b)] });
    await Promise.all([first, second]);
    expect(isInstallPending(session.get(), a)).toBe(false);
    expect(isInstallPending(session.get(), b)).toBe(false);
    expect(installationSwitchBlocked(session.get())).toBeNull();
  });

  test("a reported failure says so, clears pending and allows a retry", async () => {
    const { session, log, installAnswers } = await deferredHarness();
    const r = result("1", "Plater");
    const first = session.actions.install(r);
    installAnswers[0]!.resolve({ addon: addon(), operation: { ...op("failed"), error: "nope" } });
    await first;
    expect(log).toContain("error Couldn't install Plater | nope");
    expect(isInstallPending(session.get(), r)).toBe(false);
    void session.actions.install(r);
    expect(installs(log)).toHaveLength(2);
  });

  test("a rejected RPC stays pending through the list read, then allows a retry", async () => {
    const { session, log, installAnswers, listAnswers } = await deferredHarness();
    const r = result("1", "Plater");
    const first = session.actions.install(r);
    installAnswers[0]!.reject(new Error("engine down"));
    await flush();
    expect(log).toContain("error Couldn't install Plater | engine down");
    expect(isInstallPending(session.get(), r)).toBe(true);
    listAnswers[0]!.resolve({ addons: [] });
    await first;
    expect(isInstallPending(session.get(), r)).toBe(false);
    void session.actions.install(r);
    expect(installs(log)).toHaveLength(2);
  });

  test("a failed list read after an install keeps the last list and still clears pending", async () => {
    const { session, log, installAnswers, listAnswers } = await deferredHarness();
    const before = session.reloadAddons();
    listAnswers[0]!.resolve({ addons: [addon()] });
    await before;
    const r = result("1");
    const running = session.actions.install(r);
    installAnswers[0]!.resolve(ok);
    await flush();
    listAnswers[1]!.reject(new Error("engine down"));
    await running;
    expect(log).toContain("error Couldn't load addons | engine down");
    expect(session.get().addons.map((a) => a.id)).toEqual(["a1"]);
    expect(isInstallPending(session.get(), r)).toBe(false);
  });

  test("an installed addon's row shows busy on its result while it updates", async () => {
    const r = result("61284");
    const { session } = await harness({
      "addons.list": { addons: [addon({ canReinstall: true })] },
      "addons.update": () => new Promise(() => {}),
    });
    await session.reloadAddons();
    expect(catalogueResult(session.get(), r)).toMatchObject({ pending: false });
    void session.actions.update(addon());
    expect(catalogueResult(session.get(), r)).toMatchObject({
      pending: true,
      installLabel: "Reinstall",
    });
  });
});

describe("addon session: installation switching against catalogue installs", () => {
  const result = (externalId: string) =>
    ({ providerId: "Curse", externalId, name: `Addon ${externalId}` }) as SearchResult;
  const sent = (log: string[], prefix: string) => log.filter((line) => line.startsWith(prefix));
  const ok = { addon: addon(), operation: op("installed") };

  /** Every engine call the switch and installs make answers only when the test says. */
  async function deferredHarness() {
    const answers: Record<string, ReturnType<typeof deferred<unknown>>[]> = {};
    const later =
      <K extends MethodName>(method: K) =>
      () => {
        const d = deferred<unknown>();
        (answers[method] ??= []).push(d);
        return d.promise as Promise<MethodMap[K]["result"]>;
      };
    const h = await harness({
      "addons.install": later("addons.install"),
      "addons.list": later("addons.list"),
      "installations.select": later("installations.select"),
      "installations.list": later("installations.list"),
    });
    const answer = (method: string, i = 0) => answers[method]![i]!;
    return { ...h, answer };
  }

  test("a pending install blocks switching; a stale selector callback sends nothing", async () => {
    const { session, log, answer } = await deferredHarness();
    expect(installationSwitchBlocked(session.get())).toBeNull();
    const running = session.actions.install(result("1"));
    expect(installationSwitchBlocked(session.get())).toBe("Wait for addon installs to finish.");
    // A selector opened before the install started, picked now.
    await session.selectInstallation("i2");
    expect(sent(log, "installations.select")).toEqual([]);
    expect(session.get().selectedId).toBe("i1");
    answer("addons.install").resolve(ok);
    await flush();
    answer("addons.list").resolve({ addons: [] });
    await running;
    expect(installationSwitchBlocked(session.get())).toBeNull();
  });

  test("an install during a switch sends nothing; after it settles a fresh install goes out", async () => {
    const { session, log, answer } = await deferredHarness();
    const switching = session.selectInstallation("i2");
    // A Results X or channel-menu pick from before the switch.
    await session.actions.install(result("1"), "beta");
    expect(sent(log, "addons.install")).toEqual([]);
    expect(isInstallPending(session.get(), result("1"))).toBe(false);
    answer("installations.select").resolve({});
    await flush();
    // Selected, its list still loading: still switching.
    await session.actions.install(result("1"));
    expect(sent(log, "addons.install")).toEqual([]);
    answer("addons.list").resolve({ addons: [] });
    await switching;
    expect(session.get().selectedId).toBe("i2");
    await flush();
    // Nothing was queued.
    expect(sent(log, "addons.install")).toEqual([]);
    void session.actions.install(result("1"));
    expect(sent(log, "addons.install")).toEqual([
      'addons.install {"installationId":"i2","providerId":"Curse","externalId":"1"}',
    ]);
  });

  test("a failed selection RPC or a failed list load ends the switch", async () => {
    const { session, log, answer } = await deferredHarness();
    const refused = session.selectInstallation("i2");
    answer("installations.select").reject(new Error("no such installation"));
    await flush();
    // The engine kept the installation that was active.
    answer("installations.list").resolve({ installations: [installation("i1", true)] });
    await refused;
    expect(log).toContain("error Couldn't switch installation | no such installation");
    void session.actions.install(result("1"));
    expect(sent(log, "addons.install")).toHaveLength(1);
    answer("addons.install").resolve(ok);
    await flush();
    answer("addons.list").resolve({ addons: [] });
    await flush();

    const unread = session.selectInstallation("i3");
    answer("installations.select", 1).resolve({});
    await flush();
    answer("addons.list", 1).reject(new Error("engine down"));
    await unread;
    expect(log).toContain("error Couldn't load addons | engine down");
    void session.actions.install(result("2"));
    expect(sent(log, "addons.install")).toHaveLength(2);
  });

  test("a failed selection keeps the switch going until its installation reload has settled", async () => {
    const { session, log, answer } = await deferredHarness();
    const refused = session.selectInstallation("i2");
    answer("installations.select").reject(new Error("no such installation"));
    await flush();
    expect(log).toContain("error Couldn't switch installation | no such installation");
    // The reload is out: still switching, so installs and picks are refused.
    expect(session.get().switching).toBe(true);
    await session.actions.install(result("1"));
    await session.selectInstallation("i3");
    expect(sent(log, "addons.install")).toEqual([]);
    expect(sent(log, "installations.select")).toHaveLength(1);
    answer("installations.list").resolve({ installations: [] });
    await refused;
    expect(session.get().switching).toBe(false);
    void session.actions.install(result("1"));
    expect(sent(log, "addons.install")).toHaveLength(1);
  });

  test("switching returns once the last install settles: success, failure, rejection, failed read", async () => {
    const { session, log, answer } = await deferredHarness();
    const success = session.actions.install(result("1"));
    const failure = session.actions.install(result("2"));
    const rejection = session.actions.install(result("3"));
    answer("addons.install", 1).resolve({
      addon: addon(),
      operation: { ...op("failed"), error: "nope" },
    });
    await failure;
    expect(installationSwitchBlocked(session.get())).not.toBeNull();
    answer("addons.install", 2).reject(new Error("engine down"));
    answer("addons.install", 0).resolve(ok);
    await flush();
    // One read shows both; it fails, and the restriction still lifts.
    answer("addons.list").reject(new Error("engine down"));
    await Promise.all([success, rejection]);
    expect(log).toContain("error Couldn't load addons | engine down");
    expect(installationSwitchBlocked(session.get())).toBeNull();
    const switching = session.selectInstallation("i2");
    expect(sent(log, "installations.select")).toEqual([
      'installations.select {"installationId":"i2"}',
    ]);
    answer("installations.select").resolve({});
    await flush();
    answer("addons.list", 1).resolve({ addons: [] });
    await switching;
    expect(session.get().selectedId).toBe("i2");
  });
});

test("external install holds switching until its final list lands", async () => {
  const { session, fake } = await harness({});
  const install = session.installElsewhere("i1", async () => null);
  await settle();
  expect(installationSwitchBlocked(session.get())).toBe("Wait for addon installs to finish.");
  await fake.next("addons.list").resolve({ addons: [addon({ id: "new" })] });
  await install;
  expect(installationSwitchBlocked(session.get())).toBeNull();
});

test("a list from the previous selection cannot replace the selected installation", async () => {
  const { session, fake } = await harness({});
  const old = session.reloadAddons();
  const oldRead = fake.next("addons.list");
  fake.answers["installations.list"] = { installations: [installation("i2", true)] };
  await session.reloadInstallations();
  const current = session.reloadAddons();
  await fake.pending("addons.list")[1]!.resolve({ addons: [addon({ id: "current" })] });
  await current;
  await oldRead.resolve({ addons: [addon({ id: "old" })] });
  await old;
  expect(session.get().addons.map((a) => a.id)).toEqual(["current"]);
});

test("a newly discovered recovery refusal reloads recovery without an error toast", async () => {
  const { session, log } = await harness({
    "addons.refresh": engineFailure("recovery_required"),
    "addons.list": { addons: [addon()], unverified: true },
    "installations.recoveryStatus": {
      stateFile: { status: "readable" },
      installations: [{ installationId: "i1", status: "recoveryRequired" }],
    },
  });
  expect(await session.rescanInstallation("i1")).toBe("recovery");
  expect(recoveryNeededFor(session.get())?.id).toBe("i1");
  expect(session.get().addonsUnverified).toBe(true);
  expect(log.some((line) => line.startsWith("error "))).toBe(false);
});

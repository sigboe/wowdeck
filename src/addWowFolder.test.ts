/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import type { FoundInstallation, Installation } from "./types";
import {
  addInstallation,
  addWowFolder,
  type AddInstallationRequest,
  type AddWowFolderDeps,
} from "./addWowFolder";

const installation = (gameType: Installation["gameType"], path: string, displayName: string) =>
  ({ id: `id-${path}`, gameType, path, displayName }) as Installation;

/** Fakes for every collaborator; records what the engine was asked and what the player saw. */
function fakes(opts: {
  picked: string | null;
  found?: FoundInstallation[];
  installations?: Installation[];
  addResult?: Installation[];
  addError?: Error;
}) {
  const calls: { method: string; params: unknown }[] = [];
  const toasts: string[] = [];
  const modals: AddInstallationRequest[] = [];
  let reloads = 0;
  const deps: AddWowFolderDeps = {
    pickFolder: async () => opts.picked,
    rpc: (async (method: string, params: unknown) => {
      calls.push({ method, params });
      if (method === "installations.inspect") return { found: opts.found ?? [] };
      if (method === "installations.add") {
        if (opts.addError) throw opts.addError;
        return { installations: opts.addResult ?? [] };
      }
      throw new Error(`unexpected ${method}`);
    }) as AddWowFolderDeps["rpc"],
    openModal: (request) => modals.push(request),
    toast: (title, body = "") => toasts.push(body ? `${title} | ${body}` : title),
    toastError: (title) => toasts.push(`error: ${title}`),
    installations: opts.installations ?? [],
    onAdded: async () => {
      reloads++;
    },
  };
  return {
    deps,
    calls,
    toasts,
    modals,
    adds: () => calls.filter((c) => c.method === "installations.add").map((c) => c.params),
    reloads: () => reloads,
  };
}

const ROOT = "/games/World of Warcraft";
const THREE: FoundInstallation[] = [
  { gameType: "retail", displayName: "Retail" },
  { gameType: "classic_era", displayName: "Classic Era" },
  { gameType: "classic", displayName: "Classic" },
];

describe("Add WoW folder", () => {
  test("a folder holding three versions adds all three and reports the count", async () => {
    const f = fakes({
      picked: ROOT,
      found: THREE,
      addResult: [
        installation("retail", `${ROOT}/_retail_`, "Retail"),
        installation("classic_era", `${ROOT}/_classic_era_`, "Classic Era"),
        installation("classic", `${ROOT}/_classic_`, "Classic"),
      ],
    });
    await addWowFolder(f.deps);
    expect(f.adds()).toEqual([{ path: ROOT }]);
    expect(f.modals).toEqual([]);
    expect(f.toasts).toEqual(["Added 3 installations | Retail, Classic Era, Classic"]);
    expect(f.reloads()).toBe(1);
  });

  test("a single version folder opens Add installation with its name and version", async () => {
    const f = fakes({
      picked: `${ROOT}/_classic_era_`,
      found: [{ gameType: "classic_era", displayName: "Classic Era" }],
    });
    await addWowFolder(f.deps);
    expect(f.adds()).toEqual([]);
    expect(f.modals).toEqual([
      { path: `${ROOT}/_classic_era_`, displayName: "Classic Era", gameType: "classic_era" },
    ]);
  });

  test("a parent holding only one version opens the same modal", async () => {
    const f = fakes({ picked: ROOT, found: [{ gameType: "retail", displayName: "Retail" }] });
    await addWowFolder(f.deps);
    expect(f.adds()).toEqual([]);
    expect(f.modals).toEqual([{ path: ROOT, displayName: "Retail", gameType: "retail" }]);
  });

  test("an unrecognised folder opens the modal named after the folder, no version chosen", async () => {
    const f = fakes({ picked: "/mnt/sd/WoW Custom/", found: [] });
    await addWowFolder(f.deps);
    expect(f.adds()).toEqual([]);
    expect(f.modals).toEqual([
      { path: "/mnt/sd/WoW Custom/", displayName: "WoW Custom", gameType: null },
    ]);
  });

  test("a folder the engine can't inspect counts as unrecognised", async () => {
    const f = fakes({ picked: "/mnt/odd", found: [] });
    f.deps.rpc = (async () => {
      throw new Error("unreadable");
    }) as unknown as AddWowFolderDeps["rpc"];
    await addWowFolder(f.deps);
    expect(f.modals).toEqual([{ path: "/mnt/odd", displayName: "odd", gameType: null }]);
  });

  test("a folder whose installations are all added says so and opens nothing", async () => {
    const f = fakes({
      picked: `${ROOT}/_retail_/`,
      found: [{ gameType: "retail", displayName: "Retail" }],
      installations: [installation("retail", `${ROOT}/_retail_`, "My Retail")],
    });
    await addWowFolder(f.deps);
    expect(f.adds()).toEqual([]);
    expect(f.modals).toEqual([]);
    expect(f.toasts).toEqual(["Already added: Retail"]);
    expect(f.reloads()).toBe(0);
  });

  test("a parent with every version added names them all", async () => {
    const f = fakes({
      picked: ROOT,
      found: THREE,
      installations: [
        installation("retail", `${ROOT}/_retail_`, "Retail"),
        installation("classic_era", `${ROOT}/_classic_era_`, "Classic Era"),
        installation("classic", `${ROOT}/_classic_`, "Classic"),
      ],
    });
    await addWowFolder(f.deps);
    expect(f.toasts).toEqual(["Already added: Retail, Classic Era, Classic"]);
  });

  test("the same version in another folder is not a duplicate", async () => {
    const f = fakes({
      picked: "/mnt/sd/World of Warcraft/_retail_",
      found: [{ gameType: "retail", displayName: "Retail" }],
      installations: [installation("retail", `${ROOT}/_retail_`, "Retail")],
    });
    await addWowFolder(f.deps);
    expect(f.modals).toHaveLength(1);
  });

  test("a partly added parent adds only the new versions and names them", async () => {
    const retail = installation("retail", `${ROOT}/_retail_`, "Retail");
    const f = fakes({
      picked: ROOT,
      found: THREE,
      installations: [retail],
      // The engine answers with every installation the folder holds.
      addResult: [
        retail,
        installation("classic_era", `${ROOT}/_classic_era_`, "Classic Era"),
        installation("classic", `${ROOT}/_classic_`, "Classic"),
      ],
    });
    await addWowFolder(f.deps);
    expect(f.adds()).toEqual([{ path: ROOT }]);
    expect(f.modals).toEqual([]);
    expect(f.toasts).toEqual(["Added Classic Era, Classic"]);
    expect(f.reloads()).toBe(1);
  });

  test("a parent with one new version opens the modal for that one", async () => {
    const f = fakes({
      picked: ROOT,
      found: THREE,
      installations: [
        installation("retail", `${ROOT}/_retail_`, "Retail"),
        installation("classic", `${ROOT}/_classic_`, "Classic"),
      ],
    });
    await addWowFolder(f.deps);
    expect(f.adds()).toEqual([]);
    expect(f.modals).toEqual([{ path: ROOT, displayName: "Classic Era", gameType: "classic_era" }]);
  });

  test("backing out of the picker adds nothing", async () => {
    const f = fakes({ picked: null, found: THREE });
    await addWowFolder(f.deps);
    expect(f.calls).toEqual([]);
    expect(f.modals).toEqual([]);
    expect(f.toasts).toEqual([]);
  });

  test("a failed direct add shows an error toast", async () => {
    const f = fakes({ picked: ROOT, found: THREE, addError: new Error("disk") });
    await addWowFolder(f.deps);
    expect(f.toasts).toEqual(["error: Couldn't add installations"]);
    expect(f.reloads()).toBe(0);
  });
});

describe("Add installation modal's Add", () => {
  const request = { path: `${ROOT}/_retail_`, displayName: "Main", clientType: "retail" as const };

  test("adds the folder under the chosen name and version, then reloads", async () => {
    const f = fakes({
      picked: null,
      addResult: [installation("retail", `${ROOT}/_retail_`, "Main")],
    });
    expect(await addInstallation(f.deps, request)).toBe(true);
    expect(f.adds()).toEqual([request]);
    expect(f.toasts).toEqual(["Added Main"]);
    expect(f.reloads()).toBe(1);
  });

  test("a failed add shows an error and reports failure so the modal stays open", async () => {
    const f = fakes({ picked: null, addError: new Error("no markers") });
    expect(await addInstallation(f.deps, request)).toBe(false);
    expect(f.toasts).toEqual(["error: Couldn't add installation"]);
    expect(f.reloads()).toBe(0);
  });
});

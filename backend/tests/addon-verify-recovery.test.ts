/**
 * Verify recovery (ADR 0006, #109): when the player has put a stopped
 * operation's original files back by hand, the engine checks that the
 * recorded original arrangement is there (every byte, and nothing where
 * nothing was) and only then puts the original record back and lifts the
 * block. It never changes the evidence to make a different state match.
 * Seen through the addon-service boundary with real temporary game
 * folders, reopened storage and FaultInjectingFs failing named stages.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddonService } from "../src/wow/addons/AddonService";
import { NotFoundError } from "../src/wow/errors";
import type { HandlerDeps } from "../src/api/handlers/deps";
import { register as registerInstallations } from "../src/api/handlers/installations";
import { JsonlServer } from "../src/bridge/jsonl";
import {
  addonsOf,
  fixture,
  live,
  SHAPES,
  status,
  stoppedUpdateInA,
  tree,
  withoutWork,
  workFolders,
  type Fixture,
} from "./helpers/recovery-fixture";

/**
 * The repair the details view describes: each kept original moved back to
 * where it belongs (whatever is there now goes), and the Roll back cache
 * entry the stopped update made deleted.
 */
function repairByHand(f: Fixture, service: AddonService, id: string) {
  const AddOns = addonsOf(f.a);
  const at = (shown: string) => join(AddOns, shown.replace(/^AddOns\//, ""));
  for (const kept of service.recovery.details(f.a).operations.flatMap((op) => op.preserved)) {
    rmSync(at(kept.belongsAt), { recursive: true, force: true });
    renameSync(at(kept.location), at(kept.belongsAt));
  }
  rmSync(join(AddOns, ".wowdeck", "rollback", id), { recursive: true, force: true });
}

describe("Verify recovery after a manual repair (scenario 5)", () => {
  test("confirms the original folders, puts the original record back, then unblocks the installation", async () => {
    const f = fixture("verify-matching");
    const { id, original } = await stoppedUpdateInA(f);
    repairByHand(f, f.service, id);
    expect(live(f.a)).toEqual(original.files);

    const result = await f.service.verifyRecovery(f.a.id);

    expect(result).toEqual({ installationId: f.a.id, status: "verified", verified: ["Suite"] });
    expect(live(f.a)).toEqual(original.files);
    expect(f.store.addons.get(id)).toEqual(original.record);
    expect(f.store.addons.markers()).toEqual([]);
    expect(status(f.service, f.a)).toBe("ready");
    expect(workFolders(f.a)).toEqual([]);
    const engine = f.restart();
    expect(status(engine.service, f.a)).toBe("ready");
    expect((await engine.service.updateAddon(id)).operation.status).toBe("updated");
  });
});

/** A's files (all of AddOns), record and markers: what a refused verification must leave as they are. */
function snapshotOf(f: Fixture, store: Fixture["store"], id: string) {
  return { files: tree(addonsOf(f.a)), record: store.addons.get(id), markers: store.addons.markers() };
}

describe("Verify recovery refuses, changing nothing (scenario 6)", () => {
  /** Stops A's update, repairs it, applies `change`, verifies; asserts the refusal changed nothing. */
  async function refusedAfter(name: string, change: (f: Fixture, id: string) => void) {
    const f = fixture(name);
    const { id } = await stoppedUpdateInA(f);
    repairByHand(f, f.service, id);
    change(f, id);
    const engine = f.restart();
    const before = snapshotOf(f, engine.store, id);

    const result = await engine.service.verifyRecovery(f.a.id);

    expect(result.status).toBe("refused");
    expect(snapshotOf(f, engine.store, id)).toEqual(before);
    expect(status(engine.service, f.a)).toBe("recoveryRequired");
    expect(status(f.restart().service, f.a)).toBe("recoveryRequired");
    return result as Extract<typeof result, { status: "refused" }>;
  }

  test("before any repair, listing what still differs", async () => {
    const f = fixture("verify-unrepaired");
    const { id } = await stoppedUpdateInA(f);
    const before = snapshotOf(f, f.store, id);

    const result = await f.service.verifyRecovery(f.a.id);

    expect(result).toEqual({
      installationId: f.a.id,
      status: "refused",
      verified: [],
      reason: "The original files aren't all back yet",
      nextStep: expect.stringContaining("verify again"),
      conflicts: [
        { location: "AddOns/Suite", reason: "Its files differ from the original." },
        { location: "AddOns/SuiteLib", reason: "Its files differ from the original." },
        { location: `AddOns/.wowdeck/rollback/${id}`, reason: "Wasn't there before this addon change. Move it out of AddOns." },
      ],
    });
    expect(snapshotOf(f, f.store, id)).toEqual(before);
  });

  test("an original file edited with the same TOC version", async () => {
    const result = await refusedAfter("verify-edited", (f) => {
      writeFileSync(join(addonsOf(f.a), "Suite", "core.lua"), "-- Suite 1.0 (edited)\n");
    });
    expect(result.conflicts).toEqual([{ location: "AddOns/Suite", reason: "Its files differ from the original." }]);
  });

  test("a leftover path that was originally absent", async () => {
    const result = await refusedAfter("verify-leftover", (f, id) => {
      mkdirSync(join(addonsOf(f.a), ".wowdeck", "rollback", id), { recursive: true });
    });
    expect(result.conflicts).toEqual([
      { location: expect.stringContaining(".wowdeck/rollback/"), reason: "Wasn't there before this addon change. Move it out of AddOns." },
    ]);
  });

  test("an original folder that is missing", async () => {
    const result = await refusedAfter("verify-missing", (f) => rmSync(join(addonsOf(f.a), "SuiteLib"), { recursive: true }));
    expect(result.conflicts).toEqual([{ location: "AddOns/SuiteLib", reason: "Is missing. The original files belong here." }]);
  });

  test("an original folder swapped for a link to an identical copy", async () => {
    const result = await refusedAfter("verify-link", (f) => {
      const copy = join(f.a.location, "..", "copy");
      cpSync(join(addonsOf(f.a), "Suite"), copy, { recursive: true });
      rmSync(join(addonsOf(f.a), "Suite"), { recursive: true });
      symlinkSync(copy, join(addonsOf(f.a), "Suite"));
    });
    expect(result.conflicts).toEqual([{ location: "AddOns/Suite", reason: "Is a link to another folder." }]);
  });

  test("files that can't be read", async () => {
    const f = fixture("verify-unreadable");
    const { id } = await stoppedUpdateInA(f);
    repairByHand(f, f.service, id);
    const before = snapshotOf(f, f.store, id);
    f.fs.failAt("evidence.read");

    const result = await f.service.verifyRecovery(f.a.id);
    f.fs.clear();

    expect(result.status).toBe("refused");
    expect((result as { conflicts: unknown[] }).conflicts).toContainEqual({ location: "AddOns/Suite", reason: "Couldn't be read." });
    expect(snapshotOf(f, f.store, id)).toEqual(before);
    expect(status(f.service, f.a)).toBe("recoveryRequired");
  });

  test("a game folder that isn't available (an SD card out), never recreated", async () => {
    const f = fixture("verify-missing-root");
    const { id } = await stoppedUpdateInA(f);
    repairByHand(f, f.service, id);
    const away = `${f.a.location}-away`;
    renameSync(f.a.location, away);
    const markers = f.store.addons.markers();

    const result = await f.restart().service.verifyRecovery(f.a.id);

    expect(result).toMatchObject({ status: "refused", reason: "A's game folder isn't available" });
    expect(existsSync(f.a.location)).toBe(false);
    expect(f.restart().store.addons.markers()).toEqual(markers);
    renameSync(away, f.a.location);
    expect((await f.restart().service.verifyRecovery(f.a.id)).status).toBe("verified");
  });

  test("a game folder replaced by a copy at the same path", async () => {
    const f = fixture("verify-replaced-root");
    const { id } = await stoppedUpdateInA(f);
    repairByHand(f, f.service, id);
    const away = `${f.a.location}-away`;
    renameSync(f.a.location, away);
    cpSync(away, f.a.location, { recursive: true });
    const before = snapshotOf(f, f.store, id);

    const result = await f.restart().service.verifyRecovery(f.a.id);

    expect(result).toMatchObject({ status: "refused", reason: "This isn't the game folder the addon change started in" });
    expect(snapshotOf(f, f.restart().store, id)).toEqual(before);
  });

  test("recovery information this build can't read is not offered and refuses", async () => {
    const f = fixture("verify-malformed");
    const { id } = await stoppedUpdateInA(f);
    repairByHand(f, f.service, id);
    const state = JSON.parse(readFileSync(f.statePath, "utf-8")) as { addonTransactions: Record<string, unknown>[] };
    state.addonTransactions[0]!.evidence = { Suite: { kind: "folder", digest: 7 } };
    writeFileSync(f.statePath, JSON.stringify(state));
    const engine = f.restart();
    const before = snapshotOf(f, engine.store, id);

    expect(engine.service.recovery.details(f.a).verify).toEqual({
      available: false,
      reason: "WoWDeck Addon Manager can't read the recovery information this addon change left",
      nextStep: expect.stringContaining("by hand"),
    });
    expect(await engine.service.verifyRecovery(f.a.id)).toMatchObject({ status: "refused", verified: [] });
    expect(snapshotOf(f, engine.store, id)).toEqual(before);
  });
});

/**
 * The repair as a player with a backup copy might do it: everything in
 * AddOns but the work folder replaced by the files as they were.
 */
function putBack(f: Fixture, files: Record<string, string>) {
  const AddOns = addonsOf(f.a);
  for (const name of readdirSync(AddOns)) {
    if (name !== ".wowdeck") {
      rmSync(join(AddOns, name), { recursive: true });
    }
  }
  for (const name of existsSync(join(AddOns, ".wowdeck")) ? readdirSync(join(AddOns, ".wowdeck")) : []) {
    if (!name.startsWith("tx-")) {
      rmSync(join(AddOns, ".wowdeck", name), { recursive: true });
    }
  }
  for (const [rel, content] of Object.entries(files).filter(([p]) => !p.startsWith(".wowdeck/tx-") && p !== ".wowdeck")) {
    if (content === "<dir>") {
      mkdirSync(join(AddOns, rel), { recursive: true });
    } else {
      writeFileSync(join(AddOns, rel), content);
    }
  }
}

describe("Verify recovery of each operation, wherever its undo stopped", () => {
  for (const [shape, moves, stop] of SHAPES) {
    for (let restores = 0; restores < moves; restores++) {
      test(`${shape}, ${restores} moves back done: a repair to the original arrangement is verified`, async () => {
        const f = fixture(`verify-shape-${restores}`);
        const { id, original } = await stop(f, restores);
        putBack(f, original.files);

        const engine = f.restart();
        const result = await engine.service.verifyRecovery(f.a.id);

        expect(result.status).toBe("verified");
        expect(withoutWork(tree(addonsOf(f.a)))).toEqual(withoutWork(original.files));
        expect(engine.store.addons.get(id)).toEqual(original.record);
        expect(engine.store.addons.markers()).toEqual([]);
        expect(status(f.restart().service, f.a)).toBe("ready");
        expect(workFolders(f.a)).toEqual([]);
      });
    }
  }

  test("a new install whose folders are left in AddOns is not verified", async () => {
    const f = fixture("verify-new-install-left");
    const [, , stop] = SHAPES[0]!;
    const { id, original } = await stop(f, 0);
    const result = await f.restart().service.verifyRecovery(f.a.id);
    expect(result).toMatchObject({
      status: "refused",
      conflicts: [
        { location: "AddOns/Suite", reason: "Wasn't there before this addon change. Move it out of AddOns." },
        { location: "AddOns/SuiteLib", reason: "Wasn't there before this addon change. Move it out of AddOns." },
      ],
    });
    putBack(f, original.files);
    expect((await f.restart().service.verifyRecovery(f.a.id)).status).toBe("verified");
    expect(f.restart().store.addons.get(id)).toBeUndefined();
  });
});

describe("Verify recovery that can't finish its own steps", () => {
  test("a stray record of a stopped new install is removed; its failing write keeps the guard and the marker", async () => {
    const f = fixture("verify-record-write");
    await f.install(f.service, f.b);
    f.fs.failAt("state.write").failAt("folder.restore");
    const { operation } = await f.install(f.service, f.a);
    f.fs.clear();
    const strayId = operation.addonId!;
    // A record of the uncommitted install, as a damaged earlier write might have left.
    const state = JSON.parse(readFileSync(f.statePath, "utf-8")) as { addons: Record<string, unknown>[] };
    state.addons.push({ ...state.addons[0]!, id: strayId, installationId: f.a.id });
    writeFileSync(f.statePath, JSON.stringify(state));
    putBack(f, {});
    const engine = f.restart();
    const markers = engine.store.addons.markers();

    f.fs.failAt("state.write");
    expect(await engine.service.verifyRecovery(f.a.id)).toMatchObject({
      status: "refused",
      verified: [],
      reason: "The original files are back, but the addon list couldn't be saved",
    });
    f.fs.clear();
    expect(engine.store.addons.get(strayId)).toBeDefined();
    expect(engine.store.addons.markers()).toEqual(markers);
    expect(status(f.restart().service, f.a)).toBe("recoveryRequired");

    expect((await engine.service.verifyRecovery(f.a.id)).status).toBe("verified");
    expect(f.restart().store.addons.get(strayId)).toBeUndefined();
    expect(status(f.restart().service, f.a)).toBe("ready");
  });

  test("a failure clearing the guard after the record is saved leaves the installation guarded", async () => {
    const f = fixture("verify-guard");
    const { id, original } = await stoppedUpdateInA(f);
    repairByHand(f, f.service, id);
    f.fs.failAt("marker.write");

    const result = await f.service.verifyRecovery(f.a.id);
    f.fs.clear();

    expect(result).toMatchObject({ status: "refused", verified: [], nextStep: "Try again" });
    expect(f.store.addons.get(id)).toEqual(original.record);
    expect(status(f.service, f.a)).toBe("recoveryRequired");
    expect(status(f.restart().service, f.a)).toBe("recoveryRequired");
    expect((await f.restart().service.verifyRecovery(f.a.id)).status).toBe("verified");
    expect(status(f.restart().service, f.a)).toBe("ready");
  });
});

describe("Verify recovery and the rest of the engine", () => {
  test("is offered in the details of a recovery-required installation, not elsewhere", async () => {
    const f = fixture("verify-offered");
    await stoppedUpdateInA(f);
    expect(f.service.recovery.details(f.a).verify).toEqual({ available: true });
    expect(f.service.recovery.details(f.b).verify).toMatchObject({ available: false });
  });

  test("leaves the other installation alone, and answers a ready one as verified with nothing to verify", async () => {
    const f = fixture("verify-isolation");
    const { id } = await stoppedUpdateInA(f);
    const inB = tree(addonsOf(f.b));
    expect(await f.service.verifyRecovery(f.b.id)).toEqual({ installationId: f.b.id, status: "verified", verified: [] });
    repairByHand(f, f.service, id);
    expect((await f.service.verifyRecovery(f.a.id)).status).toBe("verified");
    expect(tree(addonsOf(f.b))).toEqual(inB);
  });

  test("an unknown installation is not found", async () => {
    const f = fixture("verify-unknown");
    await expect(f.service.verifyRecovery("nope")).rejects.toThrow(NotFoundError);
  });

  test("a marker naming no installation is not offered and refuses everywhere, kept as it is", async () => {
    const f = fixture("verify-orphan-marker");
    await f.install(f.service, f.a);
    const state = JSON.parse(readFileSync(f.statePath, "utf-8")) as Record<string, unknown>;
    writeFileSync(f.statePath, JSON.stringify({ ...state, addonTransactions: [{ transactionId: "x" }] }));
    const engine = f.restart();

    for (const i of [f.a, f.b]) {
      expect(engine.service.recovery.details(i).verify).toMatchObject({ available: false });
      expect((await engine.service.verifyRecovery(i.id)).status).toBe("refused");
    }
    expect(engine.store.addons.markers()).toEqual([{ transactionId: "x" }]);
  });
});

describe("the typed contracts", () => {
  test("installations.recoveryDetails offers verification and installations.verifyRecovery answers its result", async () => {
    const f = fixture("verify-rpc");
    const { id } = await stoppedUpdateInA(f);
    const lines: string[] = [];
    const server = new JsonlServer((l) => lines.push(l));
    registerInstallations(server, { service: f.service, installationService: f.service.installations } as unknown as HandlerDeps);
    const call = async (method: string, params: Record<string, unknown>) => {
      await server.handleLine(JSON.stringify({ id: lines.length + 1, method, params }));
      return JSON.parse(lines.at(-1)!) as { result?: Record<string, unknown>; error?: { code: string } };
    };

    expect((await call("installations.recoveryDetails", { installationId: f.a.id })).result?.verify).toEqual({ available: true });
    expect((await call("installations.verifyRecovery", { installationId: f.a.id })).result).toMatchObject({ status: "refused" });
    repairByHand(f, f.service, id);
    expect((await call("installations.verifyRecovery", { installationId: f.a.id })).result).toEqual({
      installationId: f.a.id,
      status: "verified",
      verified: ["Suite"],
    });
    expect((await call("installations.verifyRecovery", { installationId: "nope" })).error?.code).toBe("not_found");
  });
});

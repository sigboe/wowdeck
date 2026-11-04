/**
 * Retry recovery (ADR 0006, #108): on the player's request, the engine
 * checks a stopped operation's recorded evidence again and puts the
 * original folders and record back only when every byte is as the
 * operation left it; otherwise it refuses with nothing overwritten,
 * deleted, recreated, reconciled or unblocked. Seen through the
 * addon-service boundary with real temporary game folders, a fake
 * provider, reopened storage and FaultInjectingFs failing named stages.
 */
import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addonsOf,
  filesHolding,
  SHAPES,
  fixture,
  live,
  snapshot,
  status,
  stoppedUpdateInA,
  tree,
  withoutWork,
  workFolders,
  type Fixture,
} from "./helpers/recovery-fixture";
import { NotFoundError } from "../src/wow/errors";
import type { HandlerDeps } from "../src/api/handlers/deps";
import { register as registerInstallations } from "../src/api/handlers/installations";
import { JsonlServer } from "../src/bridge/jsonl";

describe("Retry recovery with matching evidence (scenario 5)", () => {
  test("puts the original folders and record back, then unblocks the installation", async () => {
    const f = fixture("matching");
    const { id, original } = await stoppedUpdateInA(f);
    expect(live(f.a)).not.toEqual(original.files);

    const result = await f.service.retryRecovery(f.a.id);

    expect(result).toEqual({ installationId: f.a.id, status: "recovered", restored: ["Suite"] });
    expect(live(f.a)).toEqual(original.files);
    expect(f.store.addons.get(id)).toEqual(original.record);
    expect(status(f.service, f.a)).toBe("ready");
    expect(workFolders(f.a)).toEqual([]);
    const engine = f.restart();
    expect(status(engine.service, f.a)).toBe("ready");
    expect(engine.store.addons.get(id)).toEqual(original.record);
    expect((await engine.service.updateAddon(id)).operation.status).toBe("updated");
  });
});

describe("Retry recovery of each operation, wherever its undo stopped", () => {
  for (const [shape, moves, stop] of SHAPES) {
    for (let restores = 0; restores < moves; restores++) {
      test(`${shape}, ${restores} moves back done: puts files, Roll back cache and record back`, async () => {
        const f = fixture(`shape-${restores}`);
        const { id, original } = await stop(f, restores);
        expect(status(f.service, f.a)).toBe("recoveryRequired");

        // After a restart, as the player would meet it.
        const engine = f.restart();
        const result = await engine.service.retryRecovery(f.a.id);

        expect(result.status).toBe("recovered");
        expect(withoutWork(tree(addonsOf(f.a)))).toEqual(withoutWork(original.files));
        expect(engine.store.addons.get(id)).toEqual(original.record);
        expect(engine.store.addons.markers()).toEqual([]);
        expect(status(engine.service, f.a)).toBe("ready");
        expect(workFolders(f.a)).toEqual([]);
      });
    }
  }
});

describe("Retry recovery refuses, changing nothing (scenario 6)", () => {
  /** Stops A's update with every move done, applies `change`, retries; asserts the refusal changed nothing. */
  async function refusedAfter(name: string, change: (f: Fixture) => void) {
    const f = fixture(name);
    const { id } = await stoppedUpdateInA(f);
    change(f);
    const before = snapshot(f, id);
    const engine = f.restart();

    const result = await engine.service.retryRecovery(f.a.id);

    expect(result.status).toBe("refused");
    expect(snapshot(f, id)).toEqual(before);
    expect(engine.store.addons.get(id)).toEqual(before.record);
    expect(status(engine.service, f.a)).toBe("recoveryRequired");
    expect(status(f.restart().service, f.a)).toBe("recoveryRequired");
    return result as Extract<typeof result, { status: "refused" }>;
  }

  test("an original file edited in place with the same TOC version", async () => {
    const result = await refusedAfter("edited-original", (f) => {
      const [kept] = filesHolding(addonsOf(f.a), "-- Suite 1.0\n");
      writeFileSync(join(addonsOf(f.a), kept!), "-- Suite 1.0 (edited)\n");
      expect(readFileSync(join(addonsOf(f.a), kept!.replace("core.lua", "Suite.toc")), "utf-8")).toContain("## Version: 1.0");
    });
    expect(result.reason).toBe("Files changed since the addon change stopped");
    expect(result.conflicts).toEqual([expect.objectContaining({ reason: expect.stringContaining("changed") })]);
  });

  test("a live file edited in place, which a retry would move away", async () => {
    await refusedAfter("edited-live", (f) => writeFileSync(join(addonsOf(f.a), "Suite", "core.lua"), "-- mine\n"));
  });

  test("a file added inside a kept folder", async () => {
    await refusedAfter("added-file", (f) => {
      const [kept] = filesHolding(addonsOf(f.a), "-- SuiteLib 1.0\n");
      writeFileSync(join(addonsOf(f.a), kept!.replace("core.lua", "extra.lua")), "-- extra\n");
    });
  });

  test("a symlink inside a kept folder", async () => {
    await refusedAfter("inner-link", (f) => {
      const [kept] = filesHolding(addonsOf(f.a), "-- SuiteLib 1.0\n");
      symlinkSync("/etc", join(addonsOf(f.a), kept!.replace("core.lua", "link")));
    });
  });

  test("a live folder swapped for a symlink to an identical copy", async () => {
    const result = await refusedAfter("swapped-link", (f) => {
      const copy = join(f.a.location, "..", "copy");
      cpSync(join(addonsOf(f.a), "Suite"), copy, { recursive: true });
      rmSync(join(addonsOf(f.a), "Suite"), { recursive: true });
      symlinkSync(copy, join(addonsOf(f.a), "Suite"));
    });
    expect(result.conflicts).toContainEqual({ location: "AddOns/Suite", reason: "Is a link to another folder." });
  });

  test("an unexpected folder where a retry would put something back", async () => {
    const f = fixture("destination");
    await f.install(f.service, f.b);
    // A new install whose undo moved SuiteLib back before stopping.
    f.fs.failAt("state.write").failAt("folder.restore", { after: 1 });
    expect((await f.install(f.service, f.a)).operation.recoveryRequired).toBe(true);
    f.fs.clear();
    expect(existsSync(join(addonsOf(f.a), "SuiteLib"))).toBe(false);
    // The player copies a SuiteLib in by hand.
    mkdirSync(join(addonsOf(f.a), "SuiteLib"));
    writeFileSync(join(addonsOf(f.a), "SuiteLib", "mine.lua"), "-- mine\n");
    const before = tree(addonsOf(f.a));

    const result = await f.restart().service.retryRecovery(f.a.id);

    expect(result).toMatchObject({
      status: "refused",
      conflicts: [{ location: "AddOns/SuiteLib", reason: "Wasn't expected here. Something else put it there." }],
    });
    expect(tree(addonsOf(f.a))).toEqual(before);
    expect(status(f.restart().service, f.a)).toBe("recoveryRequired");
  });

  test("a kept folder that is gone", async () => {
    const result = await refusedAfter("gone", (f) => {
      const [kept] = filesHolding(addonsOf(f.a), "-- SuiteLib 1.0\n");
      rmSync(join(addonsOf(f.a), dirname(kept!)), { recursive: true });
    });
    expect(result.conflicts.map((c) => c.reason)).toContain("Is missing.");
  });

  test("evidence that can't be read from disk", async () => {
    const f = fixture("unreadable-file");
    const { id } = await stoppedUpdateInA(f);
    const before = snapshot(f, id);
    f.fs.failAt("evidence.read");

    expect((await f.service.retryRecovery(f.a.id)).status).toBe("refused");
    f.fs.clear();
    expect(snapshot(f, id)).toEqual(before);
    expect(status(f.service, f.a)).toBe("recoveryRequired");
  });

  test("recorded evidence this build can't read is not offered and refuses", async () => {
    const f = fixture("malformed");
    const { id } = await stoppedUpdateInA(f);
    const state = JSON.parse(readFileSync(f.statePath, "utf-8")) as { addonTransactions: Record<string, unknown>[] };
    state.addonTransactions[0]!.evidence = { Suite: { kind: "folder", digest: 7 } };
    writeFileSync(f.statePath, JSON.stringify(state));
    const engine = f.restart();
    const before = snapshot({ ...f, store: engine.store }, id);

    expect(engine.service.recovery.details(f.a).retry).toEqual({
      available: false,
      reason: "WoWDeck Addon Manager can't read the recovery information this addon change left",
      nextStep: expect.stringContaining("by hand"),
    });
    expect(await engine.service.retryRecovery(f.a.id)).toMatchObject({ status: "refused", restored: [] });
    expect(snapshot({ ...f, store: engine.store }, id)).toEqual(before);
  });

  test("a missing game folder, which is never recreated", async () => {
    const f = fixture("missing-root");
    const { id } = await stoppedUpdateInA(f);
    const away = `${f.a.location}-away`;
    renameSync(f.a.location, away);
    const before = { files: tree(join(away, "Interface", "AddOns")), record: f.store.addons.get(id), markers: f.store.addons.markers() };

    const result = await f.restart().service.retryRecovery(f.a.id);

    expect(result).toMatchObject({ status: "refused", reason: "A's game folder isn't available" });
    expect(existsSync(f.a.location)).toBe(false);
    expect({ files: tree(join(away, "Interface", "AddOns")), record: f.restart().store.addons.get(id), markers: f.restart().store.addons.markers() }).toEqual(before);
    renameSync(away, f.a.location);
    expect((await f.restart().service.retryRecovery(f.a.id)).status).toBe("recovered");
  });

  test("a game folder replaced by a copy at the same path", async () => {
    const f = fixture("replaced-root");
    const { id } = await stoppedUpdateInA(f);
    const away = `${f.a.location}-away`;
    renameSync(f.a.location, away);
    cpSync(away, f.a.location, { recursive: true });
    const before = snapshot(f, id);

    const result = await f.restart().service.retryRecovery(f.a.id);

    expect(result).toMatchObject({ status: "refused", reason: "This isn't the game folder the addon change started in" });
    expect(snapshot(f, id)).toEqual(before);
    expect(tree(join(away, "Interface", "AddOns"))).toEqual(before.files);
  });
});

describe("Retry recovery that can't finish its own steps", () => {
  test("a failure clearing the guard after restoration leaves the installation guarded; a later retry finishes", async () => {
    const f = fixture("guard");
    const { id, original } = await stoppedUpdateInA(f);
    f.fs.failAt("marker.write");

    const result = await f.service.retryRecovery(f.a.id);
    f.fs.clear();

    expect(result).toMatchObject({ status: "refused", restored: [], nextStep: "Try again" });
    expect(live(f.a)).toEqual(original.files);
    expect(f.store.addons.get(id)).toEqual(original.record);
    expect(status(f.service, f.a)).toBe("recoveryRequired");
    expect(status(f.restart().service, f.a)).toBe("recoveryRequired");

    expect((await f.restart().service.retryRecovery(f.a.id)).status).toBe("recovered");
    expect(status(f.restart().service, f.a)).toBe("ready");
    expect(live(f.a)).toEqual(original.files);
  });

  test("a stray record of a stopped new install is removed, and its failing write keeps the guard", async () => {
    const f = fixture("stray");
    await f.install(f.service, f.b);
    f.fs.failAt("state.write").failAt("folder.restore");
    const { operation } = await f.install(f.service, f.a);
    f.fs.clear();
    const strayId = operation.addonId!;
    // A record of the uncommitted install, as a damaged earlier write might have left.
    const state = JSON.parse(readFileSync(f.statePath, "utf-8")) as { addons: Record<string, unknown>[] };
    state.addons.push({ ...state.addons[0]!, id: strayId, installationId: f.a.id });
    writeFileSync(f.statePath, JSON.stringify(state));
    const engine = f.restart();
    expect(engine.store.addons.get(strayId)).toBeDefined();

    f.fs.failAt("state.write");
    expect(await engine.service.retryRecovery(f.a.id)).toMatchObject({
      status: "refused",
      reason: "The original files are back, but the addon list couldn't be saved",
    });
    f.fs.clear();
    expect(engine.store.addons.get(strayId)).toBeDefined();
    expect(status(engine.service, f.a)).toBe("recoveryRequired");

    expect((await engine.service.retryRecovery(f.a.id)).status).toBe("recovered");
    expect(engine.store.addons.get(strayId)).toBeUndefined();
    expect(live(f.a)).toEqual({});
  });

  test("a move back that fails stops there; a later retry continues from what is left", async () => {
    const f = fixture("move-back");
    const { id, original } = await stoppedUpdateInA(f);
    f.fs.failAt("folder.restore", { after: 2 });

    expect(await f.service.retryRecovery(f.a.id)).toMatchObject({ status: "refused", reason: "Couldn't move every folder back" });
    f.fs.clear();
    expect(status(f.service, f.a)).toBe("recoveryRequired");

    expect((await f.restart().service.retryRecovery(f.a.id)).status).toBe("recovered");
    expect(live(f.a)).toEqual(original.files);
    expect(f.restart().store.addons.get(id)).toEqual(original.record);
  });
});

describe("Retry recovery and the rest of the engine", () => {
  test("is offered in the details of a recovery-required installation, not elsewhere", async () => {
    const f = fixture("offered");
    await stoppedUpdateInA(f);
    expect(f.service.recovery.details(f.a).retry).toEqual({ available: true });
    expect(f.service.recovery.details(f.b).retry).toMatchObject({ available: false });
  });

  test("leaves the other installation alone, and answers a ready one as recovered with nothing restored", async () => {
    const f = fixture("isolation");
    await stoppedUpdateInA(f);
    const inB = tree(addonsOf(f.b));

    expect(await f.service.retryRecovery(f.b.id)).toEqual({ installationId: f.b.id, status: "recovered", restored: [] });
    expect((await f.service.retryRecovery(f.a.id)).status).toBe("recovered");
    expect(tree(addonsOf(f.b))).toEqual(inB);
  });

  test("an unknown installation is not found", async () => {
    const f = fixture("unknown");
    await expect(f.service.retryRecovery("nope")).rejects.toThrow(NotFoundError);
  });

  test("a state file that can't be read is not offered, and refuses in every installation without writing", async () => {
    const f = fixture("unreadable-state");
    await stoppedUpdateInA(f);
    const damaged = `${readFileSync(f.statePath, "utf-8").slice(0, -40)} "addonTransactions": [`;
    writeFileSync(f.statePath, damaged);
    const engine = f.restart();
    engine.store.setInstallations([f.a, f.b]);
    const files = tree(addonsOf(f.a));

    for (const i of [f.a, f.b]) {
      expect(engine.service.recovery.details(i).retry).toMatchObject({
        available: false,
        reason: "WoWDeck Addon Manager can't read its saved state file, so it can't tell what to put back",
      });
      expect(await engine.service.retryRecovery(i.id)).toMatchObject({ status: "refused", restored: [] });
    }
    expect(readFileSync(f.statePath, "utf-8")).toBe(damaged);
    expect(tree(addonsOf(f.a))).toEqual(files);
  });

  test("a marker naming no installation is not offered and refuses everywhere", async () => {
    const f = fixture("orphan-marker");
    await f.install(f.service, f.a);
    const state = JSON.parse(readFileSync(f.statePath, "utf-8")) as Record<string, unknown>;
    writeFileSync(f.statePath, JSON.stringify({ ...state, addonTransactions: [{ transactionId: "x" }] }));
    const engine = f.restart();

    for (const i of [f.a, f.b]) {
      expect(engine.service.recovery.details(i)).toMatchObject({
        status: "recoveryRequired",
        retry: { available: false, reason: "An addon change left recovery information that doesn't say which installation it belongs to" },
      });
      expect((await engine.service.retryRecovery(i.id)).status).toBe("refused");
    }
    expect(engine.store.addons.markers()).toEqual([{ transactionId: "x" }]);
  });
});

describe("the typed contracts", () => {
  test("installations.recoveryDetails offers the retry and installations.retryRecovery answers its result", async () => {
    const f = fixture("rpc");
    await stoppedUpdateInA(f);
    const lines: string[] = [];
    const server = new JsonlServer((l) => lines.push(l));
    registerInstallations(server, { service: f.service, installationService: f.service.installations } as unknown as HandlerDeps);
    const call = async (method: string, params: Record<string, unknown>) => {
      await server.handleLine(JSON.stringify({ id: lines.length + 1, method, params }));
      return JSON.parse(lines.at(-1)!) as { result?: Record<string, unknown>; error?: { code: string } };
    };

    expect((await call("installations.recoveryDetails", { installationId: f.a.id })).result?.retry).toEqual({ available: true });
    expect((await call("installations.retryRecovery", { installationId: f.a.id })).result).toEqual({
      installationId: f.a.id,
      status: "recovered",
      restored: ["Suite"],
    });
    expect((await call("installations.retryRecovery", { installationId: "nope" })).error?.code).toBe("not_found");
  });
});

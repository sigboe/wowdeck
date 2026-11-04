import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FaultInjectingFs } from "../src/wow/fs/StageFs";
import { createStateStore } from "../src/wow/storage/StateStore";
import type { WowAddon, WowInstallation } from "../src/wow/models";
import type { AddonCommitEvidence, AddonRecord } from "../src/wow/addons/AddonRecords";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function dataDir(): string {
  const root = mkdtempSync(join(tmpdir(), "wowdeck-records-"));
  roots.push(root);
  return root;
}

const installation = { id: "retail-0", location: "/games/wow/_retail_", label: "Retail" } as WowInstallation;

function addon(id: string, version = "1.0"): AddonRecord {
  return { id, name: id, installationId: "retail-0", providerName: "WowUpHub", externalId: id, installedVersion: version } as WowAddon;
}

/** A store holding one installation, one addon, settings and a device id, all on disk. */
function seededStore(dir: string, fs = new FaultInjectingFs()) {
  const store = createStateStore(dir, fs);
  store.setInstallations([installation]);
  store.updateSettings({ autoUpdate: true });
  store.deviceId();
  store.addons.create(addon("a", "1.0"));
  return { store, fs };
}

const stateFile = (dir: string) => readFileSync(join(dir, "state.json"), "utf-8");

describe("a failed addon record write", () => {
  for (const stage of ["state.write", "state.replace"] as const) {
    test(`at ${stage} is reported, and the reopened store and memory keep the previous records`, () => {
      const dir = dataDir();
      const { store, fs } = seededStore(dir);
      const before = stateFile(dir);
      fs.failAt(stage);

      expect(() => store.addons.patch("a", { installedVersion: "2.0" })).toThrow();
      expect(() => store.addons.create(addon("b"))).toThrow();
      expect(() => store.addons.remove("a")).toThrow();

      expect(store.addons.all()).toEqual([addon("a", "1.0")]);
      expect(stateFile(dir)).toBe(before);
      expect(createStateStore(dir).addons.all()).toEqual([addon("a", "1.0")]);
    });
  }
});

describe("a successful addon record write", () => {
  test("is visible after reopening the store, and installations, settings and device id are unchanged", () => {
    const dir = dataDir();
    const { store } = seededStore(dir);
    const deviceId = store.deviceId();

    store.addons.patch("a", { installedVersion: "2.0" });
    store.addons.create(addon("b"));

    const reopened = createStateStore(dir);
    expect(reopened.addons.all()).toEqual([addon("a", "2.0"), addon("b")]);
    expect(reopened.installations).toEqual([installation]);
    expect(reopened.settings.autoUpdate).toBe(true);
    expect(reopened.deviceId()).toBe(deviceId);
  });

  test("goes through once the fault is gone, after a failed one", () => {
    const dir = dataDir();
    const { store, fs } = seededStore(dir);
    fs.failAt("state.replace", { times: 1 });

    expect(() => store.addons.patch("a", { installedVersion: "2.0" })).toThrow();
    store.addons.patch("a", { installedVersion: "3.0" });

    expect(createStateStore(dir).addons.all()).toEqual([addon("a", "3.0")]);
  });
});

function evidence(transactionId: string, operation: AddonCommitEvidence["operation"], addonId?: string): AddonCommitEvidence {
  return { transactionId, installationId: "retail-0", operation, ...(addonId && { addonId }), folders: [`${addonId ?? "Loose"}Folder`] };
}

describe("commit evidence", () => {
  test("is readable after reopening, with the record change it was committed with", () => {
    const dir = dataDir();
    const { store } = seededStore(dir);

    store.addons.commit({ create: [addon("b")] }, evidence("tx-install", "install", "b"));
    store.addons.commit({ patch: [{ id: "a", patch: { installedVersion: "2.0" } }] }, evidence("tx-update", "update", "a"));

    const reopened = createStateStore(dir).addons;
    expect(reopened.all()).toEqual([addon("a", "2.0"), addon("b")]);
    expect(reopened.commitEvidence("tx-install")).toEqual(evidence("tx-install", "install", "b"));
    expect(reopened.commitEvidence("tx-update")).toEqual(evidence("tx-update", "update", "a"));
  });

  test("identifies a committed managed removal that leaves no record", () => {
    const dir = dataDir();
    const { store } = seededStore(dir);

    store.addons.commit({ remove: ["a"] }, evidence("tx-remove", "remove", "a"));

    const reopened = createStateStore(dir).addons;
    expect(reopened.all()).toEqual([]);
    expect(reopened.commitEvidence("tx-remove")).toEqual(evidence("tx-remove", "remove", "a"));
  });

  test("identifies a committed unmanaged removal that never had a record", () => {
    const dir = dataDir();
    const { store } = seededStore(dir);

    store.addons.commit({}, evidence("tx-loose", "remove"));

    const reopened = createStateStore(dir).addons;
    expect(reopened.all()).toEqual([addon("a", "1.0")]);
    expect(reopened.commitEvidence("tx-loose")).toEqual(evidence("tx-loose", "remove"));
  });

  for (const stage of ["state.write", "state.replace"] as const) {
    test(`a write failing at ${stage} keeps neither the record change nor the evidence`, () => {
      const dir = dataDir();
      const { store, fs } = seededStore(dir);
      fs.failAt(stage);

      expect(() => store.addons.commit({ remove: ["a"] }, evidence("tx-remove", "remove", "a"))).toThrow();
      expect(() => store.addons.commit({}, evidence("tx-loose", "remove"))).toThrow();

      for (const records of [store.addons, createStateStore(dir).addons]) {
        expect(records.all()).toEqual([addon("a", "1.0")]);
        expect(records.commitEvidence("tx-remove")).toBeUndefined();
        expect(records.commitEvidence("tx-loose")).toBeUndefined();
      }
    });
  }

  test("a change that cannot apply publishes nothing", () => {
    const dir = dataDir();
    const { store } = seededStore(dir);

    expect(() => store.addons.commit({ patch: [{ id: "missing", patch: {} }] }, evidence("tx-x", "update", "missing"))).toThrow();
    store.addons.commit({}, evidence("tx-once", "remove"));
    expect(() => store.addons.commit({}, evidence("tx-once", "remove"))).toThrow();

    const reopened = createStateStore(dir).addons;
    expect(reopened.commitEvidence("tx-x")).toBeUndefined();
    expect(reopened.commitEvidence("tx-once")).toEqual(evidence("tx-once", "remove"));
  });

  test("stays until released; a failed release keeps it", () => {
    const dir = dataDir();
    const { store, fs } = seededStore(dir);
    store.addons.commit({}, evidence("tx-loose", "remove"));

    fs.failAt("state.replace", { times: 1 });
    expect(() => store.addons.releaseCommit("tx-loose")).toThrow();
    expect(createStateStore(dir).addons.commitEvidence("tx-loose")).toEqual(evidence("tx-loose", "remove"));
    expect(store.addons.commitEvidence("tx-loose")).toEqual(evidence("tx-loose", "remove"));

    store.addons.releaseCommit("tx-loose");
    expect(createStateStore(dir).addons.commitEvidence("tx-loose")).toBeUndefined();
  });

  test("survives later ordinary record writes and settings writes", () => {
    const dir = dataDir();
    const { store } = seededStore(dir);
    store.addons.commit({}, evidence("tx-loose", "remove"));

    store.addons.patch("a", { isIgnored: true });
    store.updateSettings({ autoUpdate: false });

    expect(createStateStore(dir).addons.commitEvidence("tx-loose")).toEqual(evidence("tx-loose", "remove"));
  });
});

describe("state files without transaction metadata", () => {
  test("load as before, and an addon write adds no transaction metadata", () => {
    const dir = dataDir();
    const legacy = readFileSync(join(import.meta.dir, "fixtures", "state", "legacy-state.json"), "utf-8");
    writeFileSync(join(dir, "state.json"), legacy);
    const store = createStateStore(dir);
    const [first] = store.addons.all();

    expect(store.addons.commitsFor("retail-0")).toEqual([]);
    store.addons.patch(first!.id, { isIgnored: true });

    expect(JSON.parse(stateFile(dir))).not.toHaveProperty("addonCommits");
    expect(createStateStore(dir).addons.require(first!.id).isIgnored).toBe(true);
  });

  test("malformed evidence entries are dropped; good ones are kept", () => {
    const dir = dataDir();
    const good = evidence("tx-good", "remove", "a");
    writeFileSync(
      join(dir, "state.json"),
      JSON.stringify({
        addons: [],
        addonCommits: [good, null, "tx", { ...good, transactionId: "" }, { ...good, operation: "explode" }, { ...good, folders: [1] }],
      }),
    );

    expect(createStateStore(dir).addons.commitsFor("retail-0")).toEqual([good]);
  });
});

describe("settings persistence", () => {
  test("still logs a failed write and carries on, keeping the change in memory", () => {
    const dir = dataDir();
    const { store, fs } = seededStore(dir);
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      fs.failAt("state.replace", { times: 1 });
      expect(() => store.updateSettings({ autoUpdate: false })).not.toThrow();
    } finally {
      console.error = original;
    }
    expect(errors).toHaveLength(1);
    expect(store.settings.autoUpdate).toBe(false);
    expect(createStateStore(dir).settings.autoUpdate).toBe(true);
  });
});

describe("the fault-injection adapter", () => {
  test("fails a named stage after the given number of successes, for the given number of calls", () => {
    const dir = dataDir();
    const { store, fs } = seededStore(dir);
    fs.failAt("state.write", { after: 1, times: 2 });

    store.addons.patch("a", { installedVersion: "2.0" });
    expect(() => store.addons.patch("a", { installedVersion: "3.0" })).toThrow("Injected failure at state.write");
    expect(() => store.addons.patch("a", { installedVersion: "3.0" })).toThrow("Injected failure at state.write");
    store.addons.patch("a", { installedVersion: "4.0" });

    expect(createStateStore(dir).addons.all()).toEqual([addon("a", "4.0")]);
  });

  test("leaves no temporary file behind when the replace fails", () => {
    const dir = dataDir();
    const { store, fs } = seededStore(dir);
    fs.failAt("state.replace");

    expect(() => store.addons.remove("a")).toThrow();
    expect(readdirSync(dir)).toEqual(["state.json"]);
  });
});

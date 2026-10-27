/**
 * End-to-end: the selected installation is reported on the wire and
 * survives an engine process restart (plugin reload).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "..", "out", "wowdeck");
const ROOT = "/tmp/opencode/wowdeck-tests/engine-selection";

let engine: Bun.Subprocess<"pipe"> | undefined;
let nextId = 0;
const pending = new Map<number, (value: any) => void>();

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    engine!.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 15_000);
  });
}

function spawnEngine(): Bun.Subprocess<"pipe"> {
  const proc = Bun.spawn([BIN], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: {
      ...process.env,
      HOME: join(ROOT, "home"),
      WOWDECK_DATA_DIR: join(ROOT, "data"),
      WOWDECK_HUB_URL: "http://127.0.0.1:1", // must never be contacted here
      WOWDECK_TUKUI_URL: "http://127.0.0.1:1/tukui/addons",
    },
  });
  (async () => {
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        }
      }
    }
  })();
  return proc;
}

const PRODUCT_FOR_FLAVOR: Record<string, string> = { _retail_: "wow", _classic_era_: "wow_classic_era" };

/**
 * Real layout: `.build.info` is shared, pipe-delimited, in the WoW root,
 * matched by Product via each flavor's own `.flavor.info`. See
 * docs/wow-client-identity.md.
 */
function flavor(name: string, version: string): string {
  const wowRoot = join(ROOT, "home/Applications/World of Warcraft");
  const dir = join(wowRoot, name);
  mkdirSync(join(dir, "Interface", "AddOns"), { recursive: true });
  const product = PRODUCT_FOR_FLAVOR[name]!;
  writeFileSync(join(dir, ".flavor.info"), `Product Flavor!STRING:0\n${product}\n`);
  return `${product}|${version}`;
}

beforeAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
  const rows = [flavor("_retail_", "11.0.2"), flavor("_classic_era_", "1.15.7")];
  writeFileSync(
    join(ROOT, "home/Applications/World of Warcraft", ".build.info"),
    `Product!STRING:0|Version!STRING:0\n${rows.join("\n")}\n`,
  );
  engine = spawnEngine();
});

afterAll(() => {
  engine?.kill();
  if (!process.env.WOWDECK_TEST_KEEP) {
    rmSync(ROOT, { recursive: true, force: true });
  }
});

describe("engine selection persistence", () => {
  test("detect reports exactly one selected installation", async () => {
    const res = await send("installations.detect");
    const installs = res.result.installations;
    expect(installs).toHaveLength(2);
    expect(installs.filter((i: any) => i.selected)).toHaveLength(1);
    expect(installs.find((i: any) => i.gameType === "retail").selected).toBe(true);
  });

  test("selecting classic era updates the wire selection", async () => {
    const list = await send("installations.list");
    const era = list.result.installations.find((i: any) => i.gameType === "classic_era");

    const sel = await send("installations.select", { installationId: era.id });
    expect(sel.result.installation.selected).toBe(true);

    const after = await send("installations.list");
    expect(after.result.installations.find((i: any) => i.gameType === "classic_era").selected).toBe(true);
    expect(after.result.installations.find((i: any) => i.gameType === "retail").selected).toBe(false);
  });

  test("selection survives engine restart without re-detecting", async () => {
    engine!.kill();
    await engine!.exited;
    engine = spawnEngine();

    const res = await send("installations.list");
    const installs = res.result.installations;
    expect(installs).toHaveLength(2);
    expect(installs.find((i: any) => i.gameType === "classic_era").selected).toBe(true);

    // addon queries target the persisted selection
    const addons = await send("addons.list");
    expect(addons.result.addons).toEqual([]);
  });

  test("selecting an unknown installation returns a structured error", async () => {
    const res = await send("installations.select", { installationId: "nope" });
    expect(res.error.code).toBe("not_found");
  });

  test("manual add via RPC registers an addon-data flavor", async () => {
    // reference-Deck style streamed install: only Interface/
    const manual = join(ROOT, "extra/WoWClassicCopy");
    mkdirSync(join(manual, "Interface", "AddOns"), { recursive: true });

    const add = await send("installations.add", {
      path: manual,
      displayName: "My Classic Copy",
      clientType: "classic_era",
    });
    expect(add.result.installations).toHaveLength(1);
    expect(add.result.installations[0].source).toBe("manual");
    expect(add.result.installations[0].displayName).toBe("My Classic Copy");
    expect(add.result.installations[0].gameType).toBe("classic_era");

    // invalid dir → structured error
    const bad = await send("installations.add", { path: join(ROOT, "home") });
    expect(bad.error.code).toBe("invalid_request");
  });

  // gameTypeWire (main.ts) must use getClientTypeForGameType rather than
  // its own hand-written clientType->wire table — a hand-written table
  // previously collapsed ClassicBeta into the generic "classic" value
  // instead of the dedicated "classic_beta" wire value, breaking the
  // dynamic search helper text, which reads this field to label the
  // installation.
  test("Classic Beta installations round-trip their wire gameType correctly", async () => {
    const manual = join(ROOT, "extra/ClassicBetaCopy");
    mkdirSync(join(manual, "Interface", "AddOns"), { recursive: true });

    const add = await send("installations.add", {
      path: manual,
      displayName: "My Classic Beta Copy",
      clientType: "classic_beta",
    });
    expect(add.result.installations).toHaveLength(1);
    expect(add.result.installations[0].gameType).toBe("classic_beta");
  });

  test("removing an installation keeps its files and falls back selection", async () => {
    const list = await send("installations.list");
    const manual = list.result.installations.find((i: any) => i.source === "manual");
    const previous = list.result.installations.find((i: any) => i.selected);
    expect(manual).toBeDefined();

    const res = await send("installations.remove", { installationId: manual.id });
    expect(res.result.installationId).toBe(manual.id);
    // files untouched
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(manual.path, "Interface", "AddOns"))).toBe(true);

    const after = await send("installations.list");
    expect(after.result.installations.find((i: any) => i.id === manual.id)).toBeUndefined();
    expect(after.result.installations.find((i: any) => i.selected).id).toBe(previous.id);
  });
});

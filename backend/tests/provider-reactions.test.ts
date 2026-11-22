/**
 * Reactions that live behind the modules, not in the RPC handlers: a
 * provider's enable and disable hooks run on every path that flips it, and a
 * settings write reaches its subscribers whoever made it.
 */

import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configFromEnv, startEngine } from "../src/engine";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { TradeSkillMasterAuth, TradeSkillMasterProvider } from "../src/wow/tsm/TradeSkillMasterAuth";
import { loadCassette, ReplayNetwork } from "./providers/cassette";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  for (const done of cleanup.splice(0).reverse()) await done();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A TradeSkillMaster source against a local token endpoint that always answers with a session. */
async function tradeSkillMaster() {
  const tokens = await Bun.file(join(import.meta.dir, "fixtures/tsm/token.json")).json();
  tokens.access_token = `e30.${Buffer.from(JSON.stringify({ preferred_username: "fixture-player" })).toString("base64url")}.fixture`;
  const mock = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(tokens) });
  cleanup.push(() => mock.stop(true));
  const dir = tempDir("tsm-hooks-");
  const base = `http://127.0.0.1:${mock.port}`;
  const registry = new ProviderRegistry();
  const timers: unknown[] = [];
  const auth = new TradeSkillMasterAuth(dir, "1", registry, { authorize: base, token: base, revoke: base }, {
    setTimeout: () => timers.push(0),
    clearTimeout: () => {},
  });
  cleanup.push(() => auth.cancel());
  registry.register(new TradeSkillMasterProvider(auth));
  const store = createStateStore(dir);
  registry.attachStore(store);
  /** An account remembered from an earlier sign-in. */
  const rememberAccount = () => {
    writeFileSync(join(dir, "tsm-refresh-token"), "fixture-refresh");
    writeFileSync(join(dir, "tsm-account"), "fixture-player");
  };
  return { registry, auth, store, rememberAccount };
}

test("turning TradeSkillMaster on through the registry continues the remembered session", async () => {
  const { registry, auth, rememberAccount } = await tradeSkillMaster();
  rememberAccount();

  await registry.setEnabled("TradeSkillMaster", true);

  expect(auth.status()).toMatchObject({ state: "signedIn", account: "fixture-player" });
  expect(registry.usable("TradeSkillMaster")).toBeDefined();
});

test("turning TradeSkillMaster off through the registry pauses the session and keeps the account", async () => {
  const { registry, auth, rememberAccount } = await tradeSkillMaster();
  rememberAccount();
  await registry.setEnabled("TradeSkillMaster", true);

  await registry.setEnabled("TradeSkillMaster", false);

  expect(auth.status()).toEqual({ state: "off", account: "fixture-player" });
  expect(registry.get("TradeSkillMaster")!.enabled).toBe(false);
});

test("TradeSkillMaster without an account refuses to turn on, and the choice is not stored", async () => {
  const { registry, store } = await tradeSkillMaster();

  await expect(registry.setEnabled("TradeSkillMaster", true)).rejects.toThrow("Sign in to TradeSkillMaster first");

  expect(registry.get("TradeSkillMaster")!.enabled).toBe(false);
  expect(store.settings.enabledProviders ?? []).not.toContain("TradeSkillMaster");
});

test("a settings write refreshes provider defaults through its subscription, whoever wrote it", async () => {
  const root = tempDir("wowdeck-engine-");
  const homeDir = join(root, "home");
  mkdirSync(homeDir, { recursive: true });
  const base = configFromEnv({ HOME: homeDir, WOWDECK_DATA_DIR: join(root, "data") }, "9.9.9");
  const engine = await startEngine({ ...base, network: new ReplayNetwork(await loadCassette("wowup-hub")), now: () => Date.UTC(2026, 10, 1) });
  const curse = async () => (await engine.call("providers.list", {})).providers.find((p) => p.id === "Curse")!;
  expect(await curse()).toMatchObject({ enabled: false, configured: false });

  // Not settings.set: a write from inside the engine reaches the same subscriber.
  engine.deps.store.updateSettings({ curseApiKey: "fixture-key" });

  expect(await curse()).toMatchObject({ enabled: true, configured: true });
});

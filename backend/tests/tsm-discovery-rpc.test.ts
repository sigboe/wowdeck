import { register as registerAddons } from "../src/api/handlers/addons";
import { AddonService } from "../src/wow/addons/AddonService";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import { existsSync } from "node:fs";
import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlServer } from "../src/bridge/jsonl";
import { register } from "../src/api/handlers/providers";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { TradeSkillMasterAuth, TradeSkillMasterProvider } from "../src/wow/tsm/TradeSkillMasterAuth";
import { TradeSkillMasterData } from "../src/wow/tsm/TradeSkillMasterData";
import type { HandlerDeps } from "../src/api/handlers/deps";

test("discovery follows across flavors in recent order, stops at refusal and preserves choices", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsm-discovery-"));
  const tokens = await Bun.file(join(import.meta.dir, "fixtures/tsm/token.json")).json();
  const versions = ["Retail", "Wrath", "Classic Era", "Classic Era - Hardcore", "Season of Discovery", "Classic Era - Fresh", "Forever"];
  const folders = ["_retail_", "_classic_", "_classic_era_", "_classic_era_", "_classic_era_", "_anniversary_", "_forever_"];
  const realms = versions.map((version, n) => ({ realmId: n + 1, localizedName: `Realm${n + 1}`, regionId: n + 1, region: { regionId: n + 1, gameVersion: version, regionPrefix: "eu" }, auctionHouses: [{ type: n ? "Horde" : "All", auctionHouseId: n + 10 }] }));
  realms.push({ realmId: 100, localizedName: "Realm1", regionId: 100,
    region: { regionId: 100, gameVersion: "Retail", regionPrefix: "us" },
    auctionHouses: [{ type: "All", auctionHouseId: 100 }] });
  let follows: any[] = [];
  const posts: number[] = [];
  let deletes = 0;
  let limit = 2;
  let failReads = false;
  let failDelete = false;
  let failAfterDelete = false;
  let failRealm: string | undefined;
  const mock = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/realms") return Response.json({ items: realms });
    if (path === "/regions") return Response.json({ items: realms.map((r) => r.region) });
    if (path === "/versions") return Response.json([]);
    if (req.method === "DELETE") { if (failDelete || path === failRealm) return new Response("offline", { status: 503 }); if (req.headers.get("Content-Type") === "application/json") return new Response("Body cannot be empty", { status: 400 }); deletes++; if (failAfterDelete) failReads = true; follows = follows.filter((f) => path !== `/follows/${f.id}`); return Response.json({}); }
    if (path === "/follows" && req.method === "POST") {
      const body = await req.json() as any; posts.push(body.realmId);
      if (follows.length >= limit) return new Response("User Realm limit reached", { status: 400 });
      follows.push({ ...body, id: String(body.realmId) }); return Response.json({});
    }
    if (path === "/follows" && failReads) return new Response("offline", { status: 503 });
    if (path === "/follows") return Response.json({ items: follows });
    return Response.json(tokens);
  }});
  const base = `http://127.0.0.1:${mock.port}`;
  const callbacks = new Map<number, { fn: () => unknown; ms: number }>(); let timer = 0;
  const registry = new ProviderRegistry(); const store = createStateStore(dir);
  const auth = new TradeSkillMasterAuth(dir, "1", registry, { authorize: base, token: base, revoke: base, realms: base + "/realms", regions: base + "/regions", gameVersions: base + "/versions", userRealms: base + "/follows" }, {
    now: () => 1000000, setTimeout(fn, ms) { callbacks.set(++timer, { fn, ms }); return timer; }, clearTimeout(id) { callbacks.delete(id as number); },
  });
  const provider = new TradeSkillMasterProvider(auth); registry.register(provider); registry.attachStore(store); registry.setEnabled("TradeSkillMaster", true);
  const installations = folders.map((folder, n) => ({ id: String(n), location: join(dir, String(n), folder), clientType: n ? 2 : 0, label: "fixture", displayName: "fixture", selected: !n, defaultAddonChannelType: 0, source: "detected" as const }));
  store.setInstallations(installations);
  const write = (path: string, content: string) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, content); };
  const scopes = await Bun.file(join(import.meta.dir, "fixtures/tsm/TradeSkillMaster.lua")).text();
  const helper = await Bun.file(join(import.meta.dir, "fixtures/tsm/TradeSkillMaster_AppHelper.lua")).text();
  for (const [n, i] of installations.entries()) {
    const root = join(i.location, "WTF/Account/TEST");
    const character = join(root, `Realm${n + 1}/Hero`); mkdirSync(character, { recursive: true }); utimesSync(character, n < 2 ? 1000 : 1000 - n, n < 2 ? 1000 : 1000 - n);
    write(join(i.location, "WTF/Config.wtf"), 'SET portal "EU"');
    if (n) {
      write(join(root, "SavedVariables/TradeSkillMaster.lua"), scopes.replace("REALM", `Realm${n + 1}`));
      write(join(root, "SavedVariables/TradeSkillMaster_AppHelper.lua"), helper);
    }
  }
  rmSync(join(installations[6]!.location, "WTF/Account/TEST/SavedVariables/TradeSkillMaster_AppHelper.lua"));
  const data = new TradeSkillMasterData(auth, provider, store, dir, () => {});
  let response: any; const rpc = new JsonlServer((line) => { response = JSON.parse(line); });
  register(rpc, { store, registry, tsmAuth: auth, tsmData: data, installationService: { require: (id = "0") => installations[Number(id)] } } as unknown as HandlerDeps);
  const service = new AddonService(store, registry,
    new DownloadService(new NetworkClient(), join(dir, "downloads")),
    { addonsChanged() {}, operationResult() {} });
  registerAddons(rpc, { service, tsmData: data,
    installationService: { require: (id = "0") => installations[Number(id)] }
  } as unknown as HandlerDeps);
  const call = async (method: string, params: object = {}) => { await rpc.handleLine(JSON.stringify({ id: 1, method: "tradeskillmaster." + method, params })); expect(response.error).toBeUndefined(); return response.result; };
  const scan = async () => { for (const [id, cb] of [...callbacks]) if (cb.ms === 30000) { callbacks.delete(id); await cb.fn(); } };
  try {
    write(join(dir, "tsm-refresh-token"), "fixture"); await auth.restore(); await data.ready;
    expect(posts).toEqual([1, 2, 3]); expect(deletes).toBe(0);
    expect((await call("destination", { installationId: "2" })).realms).toMatchObject([{ id: 3, followed: false }]);
    await scan(); expect(posts).toEqual([1, 2, 3]);
    realms.push({ realmId: 99, localizedName: "Remote realm", regionId: 99, region: { regionId: 99, gameVersion: "Classic Era", regionPrefix: "us" }, auctionHouses: [{ type: "Horde", auctionHouseId: 99 }] });
    follows.push({ realmId: 99, auctionHouseType: "HORDE", id: "remote" });
    const complete = await call("account");
    expect(complete.followedCount).toBe(3);
    expect(complete.follows).toContainEqual({ realmId: 99, name: "Remote realm", region: "US", gameVersion: "Classic Era", auctionHouseType: "HORDE" });
    follows.pop();
    follows.push({ realmId: 100, auctionHouseType: "ALL", id: "us" });
    await call("account");
    expect((await call("destination", { installationId: "0" })).realms.map((r: any) => r.id)).toEqual([1]);
    expect((await call("destination", { installationId: "0" })).regions.map((r: any) => r.name)).toEqual(["EU"]);
    follows.pop();
    realms.push({ ...realms[0]!, realmId: 97, localizedName: "Existing" });
    mkdirSync(join(installations[0]!.location, "WTF/Account/TEST/Existing/Hero"), { recursive: true });
    follows.push({ realmId: 97, auctionHouseType: "ALL", id: "existing" });
    const preview = await call("cleanupPreview", { installationId: "0" });
    expect(preview).toHaveLength(1);
    follows.pop();
    realms.pop();
    rmSync(join(installations[0]!.location, "WTF/Account/TEST/Existing"), { recursive: true });
    expect(preview).toMatchObject([{ realmId: 1, region: "EU", gameVersion: "Retail" }]);
    const shared = { ...installations[0]!, id: "shared" };
    store.setInstallations([...installations, shared]);
    expect(await call("cleanupPreview", { installationId: "0" })).toEqual([]);
    store.setInstallations(installations);
    const addonPath = join(installations[0]!.location, "Interface/AddOns/TradeSkillMaster");
    write(join(addonPath, "TradeSkillMaster.toc"), "## Interface: 110005\n## Version: 4.0\n");
    failReads = true;
    const unavailable = await call("removeAddons", { installationId: "0", cleanupFollows: true, cleanupPreview: preview });
    expect(unavailable.cleanup.leftBehind).toEqual(preview);
    expect(unavailable.operations[0].status).toBe("removed");
    expect(deletes).toBe(0);
    failReads = false;
    write(join(addonPath, "TradeSkillMaster.toc"), "## Interface: 110005\n## Version: 4.0\n");
    failDelete = true;
    const cleanupFailed = await call("removeAddons", { installationId: "0", cleanupFollows: true });
    expect(cleanupFailed.cleanup.leftBehind).toMatchObject([{ realmId: 1 }]);
    expect(cleanupFailed.operations[0].status).toBe("removed");
    expect(existsSync(addonPath)).toBe(false);
    expect(auth.signedIn).toBe(true);
    failDelete = false;
    const account = await call("account");
    expect(account.followedCount).toBe(2);
    expect(account.follows).toMatchObject([
      { realmId: 1, name: "Realm1", region: "EU", gameVersion: "Retail", auctionHouseType: "ALL" },
      { realmId: 2, name: "Realm2", region: "EU", gameVersion: "Wrath", auctionHouseType: "HORDE" },
    ]);
    expect(account.account).toBeTruthy();
    failDelete = true;
    await rpc.handleLine(JSON.stringify({ id: 2, method: "tradeskillmaster.unfollow", params: { realmId: 1, auctionHouseType: "ALL" } }));
    expect(response.error).toBeDefined();
    expect((await call("account")).followedCount).toBe(2);
    expect(deletes).toBe(0);
    failDelete = false;
    failAfterDelete = true;
    expect((await call("unfollow", { realmId: 1, auctionHouseType: "ALL" })).followedCount).toBe(1);
    failReads = false; failAfterDelete = false;
    await auth.signOut(); registry.setEnabled("TradeSkillMaster", true); limit = 20;
    write(join(dir, "tsm-refresh-token"), "fixture"); await auth.restore(); await data.ready;
    expect(posts.slice(3)).toEqual([3, 4, 5, 6]);
    expect((await call("destination", { installationId: "6" })).realms).toEqual([]);
    // SavedVariables expressions are rejected as data, never executed.
    write(join(installations[6]!.location, "WTF/Account/TEST/SavedVariables/TradeSkillMaster_AppHelper.lua"), 'TradeSkillMaster_AppHelperDB = { region = (function() return "EU" end)() }');
    await scan();
    expect(posts).toHaveLength(7);
    write(join(installations[6]!.location, "WTF/Account/TEST/SavedVariables/TradeSkillMaster_AppHelper.lua"), helper);
    failReads = true;
    await scan();
    expect(posts.slice(3)).toEqual([3, 4, 5, 6]);
    failReads = false;
    await scan();
    expect(posts.slice(3)).toEqual([3, 4, 5, 6, 7]);
    rmSync(join(installations[1]!.location, "WTF"), { recursive: true });
    await scan(); expect(posts).toHaveLength(8); expect(deletes).toBe(1);
    const empty = await call("destination", { installationId: "1" });
    expect(empty.realms).toEqual([]);
    expect(empty.regions).toEqual([]);
    expect(empty.followedCount).toBe(follows.length);
    expect((await call("account")).follows).toContainEqual(expect.objectContaining({ realmId: 2 }));
    expect(follows.every((f) => f.auctionHouseType !== "ALLIANCE")).toBe(true);
    expect((await call("destination")).realms).toMatchObject([{ id: 1, followed: false, declined: true }]);
    await call("setFollow", { realmId: 1, auctionHouseType: "ALL", followed: true });
    expect((await call("destination")).realms).toMatchObject([{ id: 1, followed: true, declined: false }]);
    realms.push({ ...realms[0]!, realmId: 98, localizedName: "Extra", auctionHouses: [{ type: "All", auctionHouseId: 98 }] });
    mkdirSync(join(installations[0]!.location, "WTF/Account/TEST/Extra/Hero"), { recursive: true });
    await call("setFollow", { realmId: 98, auctionHouseType: "ALL", followed: true });
    failRealm = "/follows/1";
    const partial = await call("removeAddons", { installationId: "0", cleanupFollows: true });
    expect(partial.cleanup.removed).toMatchObject([{ realmId: 98 }]);
    expect(partial.cleanup.leftBehind).toMatchObject([{ realmId: 1 }]);
    failRealm = undefined;
    await scan();
    expect((await call("destination")).realms.find((r: any) => r.id === 98)).toMatchObject({ followed: false, declined: true });
    failAfterDelete = true;
    const finished = await call("removeAddons", { installationId: "0", cleanupFollows: true });
    expect(finished.cleanup.removed).toMatchObject([{ realmId: 1 }]);
    expect(finished.cleanup.leftBehind).toEqual([]);
    failReads = false; failAfterDelete = false;
    await scan();
    expect((await call("account")).follows.some((f: any) => f.realmId === 1 || f.realmId === 98)).toBe(false);

  } finally { await auth.signOut(); mock.stop(true); rmSync(dir, { recursive: true, force: true }); }
});

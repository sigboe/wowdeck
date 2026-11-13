import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, utimesSync, existsSync, symlinkSync, lstatSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { register as registerSystem } from "../src/api/handlers/system";
import { register as registerAddons } from "../src/api/handlers/addons";
import { AddonService } from "../src/wow/addons/AddonService";
import { recordFolders } from "../src/wow/addons/AddonRecords";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import { FileProvider } from "../src/wow/providers/file/FileProvider";
import { zipSync } from "fflate";
import { gzipSync } from "fflate";
import { JsonlServer } from "../src/bridge/jsonl";
import { register } from "../src/api/handlers/providers";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import {
  TradeSkillMasterAuth,
  TradeSkillMasterProvider,
} from "../src/wow/tsm/TradeSkillMasterAuth";
import { TradeSkillMasterData } from "../src/wow/tsm/TradeSkillMasterData";
import type { HandlerDeps } from "../src/api/handlers/deps";

test("socket auction data reaches all Retail files and destination through RPC", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsm-data-"));
  const callbacks = new Map<number, { fn: () => void | Promise<void>; ms: number }>();
  let timer = 0;
  let retryScheduled: (() => void) | undefined;
  let retryFailures = 0;
  let rejectSocket = false;
  let randomValue = 0.5;
  const logs: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  let activeDownloads = 0;
  let peakDownloads = 0;
  let blocked = false;
  let fourStarted: () => void = () => {};
  const releases: (() => void)[] = [];
  let joined!: () => void;
  const ready = new Promise<void>((r) => {
    joined = r;
  });
  const recorded = await Bun.file(join(import.meta.dir, "fixtures/tsm/auction.json")).json();
  let downloads = 0;
  let blob = gzipSync(new TextEncoder().encode(recorded.blob));
  // DEVICE 2026-11-10: TradeSkillMaster's storage answers with
  // Content-Encoding: gzip, so fetch hands over the data string unpacked.
  let encoded = false;
  let follows: any[] = [
    { realmId: 1, auctionHouseType: "ALL" },
    { realmId: 2, auctionHouseType: "ALL" },
  ];
  let ack = () => {};
  let rejectDelete = false;
  let failReload = false;
  let posts = 0;
  let showClassic = false;

  let socket: any;
  const realm = recorded.realm;
  const tokens = await Bun.file(join(import.meta.dir, "fixtures/tsm/token.json")).json();
  const mock = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) {
      const path = new URL(req.url).pathname;
      if (path === "/socket") {
        if (rejectSocket) return new Response("offline", { status: 503 });
        expect(req.headers.get("Authorization")).toBe(tokens.access_token);
        if (server.upgrade(req)) return;
      }
      if (path === "/blob") {
        expect(req.headers.get("Authorization")).toBeNull();
        downloads++;
        if (retryFailures > 0) { retryFailures--; return new Response("retry", { status: 503 }); }
        if (blocked) {
          activeDownloads++;
          peakDownloads = Math.max(peakDownloads, activeDownloads);
          if (activeDownloads === 4) fourStarted();
          return new Promise<Response>((resolve) => releases.push(() => { activeDownloads--; resolve(new Response(blob)); }));
        }
        return new Response(blob, encoded ? { headers: { "Content-Encoding": "gzip" } } : undefined);
      }
      if (["/realms", "/regions", "/versions", "/follows"].includes(path))
        expect(req.headers.get("Authorization")).toBe("Bearer " + tokens.access_token);
      if (path === "/realms")
        return Response.json({
          items: [realm, { ...realm, realmId: 2, localizedName: "Connected" }, { ...realm, realmId: 3, localizedName: "Refused" }, ...(showClassic ? [{ ...realm, realmId: 4, localizedName: "Classic realm", region: { ...realm.region, gameVersion: "Classic Era" }, auctionHouses: [{ type: "Horde", auctionHouseId: 400 }] }] : [])],
        });
      if (path === "/regions") return Response.json({ items: [realm.region] });
      if (path === "/versions") return Response.json([{ folder: "_retail_", label: "Retail" }, { folder: "_classic_era_", label: "Classic Era" }]);
      if (path === "/follows" && req.method === "POST") {
        posts++;
        return req.json().then((body: any) => {
          if (body.realmId === 3) return new Response("User Realm limit reached", { status: 400 });
          follows.push({ ...body, id: "added" });
          return Response.json({});
        });
      }
      if (path === "/follows/added" && req.method === "DELETE") {
        // The real server refuses an empty body under a JSON content type.
        if (req.headers.get("Content-Type") === "application/json")
          return Response.json({ message: "Body cannot be empty when content-type is set to 'application/json'" }, { status: 400 });
        if (rejectDelete) return new Response("unavailable", { status: 503 });
        follows = follows.filter((f) => f.realmId !== 2);
        return Response.json({});
      }
      if (path === "/follows" && failReload) return new Response("unavailable", { status: 503 });
      if (path === "/follows") return Response.json({ items: new URL(req.url).searchParams.get("page") === "2" ? follows.slice(1) : follows.slice(0, 1), metadata: { totalPages: 2 } });
      return Response.json(tokens);
    },
    websocket: {
      open(ws) {
        socket = ws;
        ws.send("0{}");
      },
      message(ws, msg) {
        if (msg === "40") {
          ws.send("40{}");
          joined();
        } else if (msg === "3") ack();
      },
    },
  });
  const base = `http://127.0.0.1:${mock.port}`;
  const registry = new ProviderRegistry();
  const store = createStateStore(dir);
  const auth = new TradeSkillMasterAuth(
    dir,
    "1",
    registry,
    {
      authorize: base,
      token: base,
      revoke: base,
      socket: base.replace("http", "ws") + "/socket",
      realms: base + "/realms",
      regions: base + "/regions",
      gameVersions: base + "/versions",
      userRealms: base + "/follows",
    },
    {
      now: () => 1000000,
      random: () => randomValue,
      setTimeout(fn, ms) {
        callbacks.set(++timer, { fn, ms });
        if (ms >= 4000 && ms <= 300000 && ms !== 45000 && ms !== 15000 && ms !== 30000) retryScheduled?.();
        return timer;
      },
      clearTimeout(id) {
        callbacks.delete(id as number);
      },
    },
  );
  const provider = new TradeSkillMasterProvider(auth);
  registry.register(provider);
  registry.attachStore(store);
  registry.setEnabled("TradeSkillMaster", true);
  const installations = ["active", "inactive", "tsm-only"].map((id) => ({
    id,
    clientType: 0,
    location: join(dir, id),
    label: id,
    displayName: id,
    selected: id === "active",
    defaultAddonChannelType: 0,
    source: "detected" as const,
  }));
  store.setInstallations(installations);
  const paths = installations.map((i) =>
    join(i.location, "Interface/AddOns", i.id === "tsm-only" ? "TradeSkillMaster" : "TradeSkillMaster_AppHelper", "AppData.lua"),
  );
  for (const path of paths) {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "-- unknown line\n");
  }
  let changes = 0;
  let candidates: { realmId: number; auctionHouseType: string }[] = [{ realmId: 1, auctionHouseType: "ALL" }, { realmId: 2, auctionHouseType: "ALL" }];
  const data = new TradeSkillMasterData(auth, provider, store, dir, () => { changes++; }, (id) => id === "classic" ? [{ realmId: 4, auctionHouseType: "HORDE" }] : candidates);
  let response: any;
  const rpc = new JsonlServer((line) => {
    response = JSON.parse(line);
  });
  register(rpc, {
    store,
    registry,
    tsmAuth: auth,
    companionCoordinator: { regenerate: async () => {} },
    tsmData: data,
    installationService: { require: (id?: string) => id === "classic" ? { ...installations[0], id: "classic", clientType: 2, location: join(dir, "_classic_era_") } : installations[0] },
  } as unknown as HandlerDeps);
  registerSystem(rpc, { store, registry, tsmData: data, service: { installationSummary: () => [] },
    recentErrors: { list: () => [] }, curseForgeAuth: { snapshot: () => ({}) } } as unknown as HandlerDeps);
  registry.register(new FileProvider());
  const service = new AddonService(store, registry, new DownloadService(new NetworkClient(), join(dir, "downloads")), { addonsChanged() {}, operationResult() {} });
  service.onFoldersChanged = (id, folders) => data.foldersChanged(id, folders);
  registerAddons(rpc, { service, installationService: { require: () => installations[0] } } as unknown as HandlerDeps);
  const call = async () => {
    await rpc.handleLine(
      JSON.stringify({ id: 1, method: "tradeskillmaster.destination", params: {} }),
    );
    expect(response.error).toBeUndefined();
    return response.result;
  };
  try {
    writeFileSync(join(dir, "tsm-refresh-token"), "fixture");
    await auth.restore();
    await ready;
    await data.ready;
    const flush = async () => {
      for (const [id, cb] of callbacks)
        if (cb.ms === 1500) {
          callbacks.delete(id);
          await cb.fn();
        }
    };
    const publish = async (name: string, payload: object) => {
      const done = new Promise<void>((resolve) => {
        ack = resolve;
      });
      socket.send("42" + JSON.stringify([name, payload]));
      socket.send("2");
      await done;
      await call();
      await flush();
    };
    const event = { ...recorded.event, url: base + "/blob" };
    await publish("realm_auctiondb", event);
    for (const path of paths) {
      expect(readFileSync(path, "utf8")).toContain(
        'for _,r in ipairs({"Tarren Mill","Connected"}) do select(2, ...).LoadData("AUCTIONDB_NON_COMMODITY_DATA",r,[[return {price=123}]]) end --<AUCTIONDB_NON_COMMODITY_DATA,Tarren Mill|Connected,100,10>',
      );
      expect(readFileSync(path, "utf8")).toContain("-- unknown line\n");
    }
    expect((await call()).realms).toMatchObject([
      { id: 1, name: "Tarren Mill", updated: 100 },
      { id: 2, name: "Connected", updated: 100 },
    ]);
    expect((await call()).regions).toEqual([{ id: 1, name: "EU", updated: null }]);
    expect(changes).toBeGreaterThan(0);
    expect((await call()).tier).toBe("free");
    expect((await call()).followedCount).toBe(2);
    expect((await call()).allowance).toBe(10);
    await publish("realm_auctiondb", event);
    expect(downloads).toBe(1);
    const rejoined = new Promise<void>((resolve) => { joined = resolve; });
    await rpc.handleLine(JSON.stringify({ id: 30, method: "tradeskillmaster.refresh", params: {} }));
    expect(response.error).toBeUndefined();
    await rejoined;
    blob = gzipSync(new TextEncoder().encode("{price=124}"));
    encoded = true;
    await publish("realm_auctiondb", event);
    encoded = false;
    expect(downloads).toBe(2);
    expect(readFileSync(paths[0]!, "utf8")).toContain("{price=124}");
    expect(readFileSync(paths[1]!, "utf8")).toContain("{price=123}");
    // A real folder transaction removes AppData; its completion must rejoin and restore it.
    const archive = join(dir, "helper.zip");
    writeFileSync(archive, zipSync({ "TradeSkillMaster_AppHelper/TradeSkillMaster_AppHelper.toc": new TextEncoder().encode("## Interface: 110200\n## Title: Helper\n## Version: 1\n") }));
    // Temporarily disable ownership for the local-file source transaction.
    registry.setEnabled("TradeSkillMaster", false);
    const transactionJoin = new Promise<void>((resolve) => { joined = resolve; });
    service.onFoldersChanged = (id, folders) => { registry.setEnabled("TradeSkillMaster", true); data.foldersChanged(id, folders); };
    await rpc.handleLine(JSON.stringify({ id: 31, method: "addons.install", params: { providerId: "File", externalId: archive } }));
    expect(response.error).toBeUndefined();
    expect(response.result.operation.status).toBe("installed");
    await transactionJoin;
    await publish("realm_auctiondb", event);
    expect(readFileSync(paths[0]!, "utf8")).toContain("{price=124}");
    expect(readFileSync(paths[1]!, "utf8")).toContain("{price=123}");
    for (const operation of ["update", "source"]) {
      registry.setEnabled("TradeSkillMaster", false);
      const nextArchive = operation === "update" ? archive : join(dir, "source.zip");
      writeFileSync(nextArchive, zipSync({ "TradeSkillMaster_AppHelper/TradeSkillMaster_AppHelper.toc": new TextEncoder().encode(`## Interface: 110200\n## Title: Helper\n## Version: ${operation}\n`) }));
      const nextJoin = new Promise<void>((resolve) => { joined = resolve; });
      const addonId = store.addons.forInstallation("active")[0]!.id;
      await rpc.handleLine(JSON.stringify({ id: 36, method: operation === "source" ? "addons.changeSource" : "addons.install", params: operation === "source" ? { addonId, providerId: "File", externalId: nextArchive } : { providerId: "File", externalId: nextArchive } }));
      expect(response.error).toBeUndefined();
      expect(response.result.operation.status).toBe("installed");
      await nextJoin;
      await publish("realm_auctiondb", event);
      expect(readFileSync(paths[0]!, "utf8")).toContain("{price=124}");
    }
    const diagnostics = async () => {
      await rpc.handleLine(JSON.stringify({ id: 32, method: "system.diagnostics", params: {} }));
      expect(response.error).toBeUndefined();
      return response.result.tradeSkillMaster;
    };
    expect(await diagnostics()).toEqual({ enabled: true, signedIn: true, tier: "free", connected: true, lastPush: 1000000, followedCount: 2 });
    const privateText = JSON.stringify(await diagnostics());
    for (const secret of [tokens.access_token, "fixture-player", "Tarren Mill", base, "/blob"]) expect(privateText).not.toContain(secret);
    // Retry failures without waiting for another push.
    retryFailures = 2;
    const beforeRetries = downloads;
    await publish("realm_auctiondb", { ...event, lastModified: 101 });
    expect(downloads - beforeRetries).toBe(3);
    // Six independent recorded-event variants share four download slots.
    blocked = true;
    const four = new Promise<void>((resolve) => { fourStarted = resolve; });
    for (const stringType of ["AUCTIONDB_NON_COMMODITY_DATA", "AUCTIONDB_NON_COMMODITY_SCAN_STAT", "AUCTIONDB_NON_COMMODITY_HISTORICAL", "SHOPPING", "AUCTIONDB_REGION_STAT", "AUCTIONDB_REGION_SALE"])
      socket.send("42" + JSON.stringify(["realm_auctiondb", { ...event, stringType, lastModified: 102 }]));
    await four;
    expect(peakDownloads).toBe(4);
    blocked = false;
    for (const release of releases.splice(0)) release();
    await call();
    await flush();
    expect(peakDownloads).toBe(4);
    // Refresh must discard old events waiting behind the four active transfers.
    blocked = true;
    const staleFour = new Promise<void>((resolve) => { fourStarted = resolve; });
    for (let n = 0; n < 6; n++) socket.send("42" + JSON.stringify(["realm_auctiondb", { ...event, lastModified: 800 + n }]));
    await staleFour;
    const beforeRefresh = downloads;
    const freshJoin = new Promise<void>((resolve) => { joined = resolve; });
    await rpc.handleLine(JSON.stringify({ id: 38, method: "tradeskillmaster.refresh", params: {} }));
    await freshJoin;
    blocked = false;
    for (const release of releases.splice(0)) release();
    await call();
    expect(downloads).toBe(beforeRefresh);
    await publish("realm_auctiondb", { ...event, lastModified: 103 });
    expect(readFileSync(paths[0]!, "utf8")).toContain(",103,10>");
    // Drop reconnect waits five seconds; a server disconnect uses deterministic jitter.
    const dropped = new Promise<void>((resolve) => { retryScheduled = resolve; });
    socket.close();
    await dropped;
    expect([...callbacks.values()].some((cb) => cb.ms === 5000)).toBe(true);
    rejectSocket = true;
    for (const [delay, nextDelay] of [[5000, 10000], [10000, 20000], [20000, 40000], [40000, 60000], [60000, 60000]]) {
      const scheduled = new Promise<void>((resolve) => { retryScheduled = resolve; });
      const entry = [...callbacks].find(([, cb]) => cb.ms === delay)!;
      callbacks.delete(entry[0]);
      await entry[1].fn();
      await scheduled;
      expect([...callbacks.values()].some((cb) => cb.ms === nextDelay)).toBe(true);
    }
    rejectSocket = false;
    const wakeJoin = new Promise<void>((resolve) => { joined = resolve; });
    await rpc.handleLine(JSON.stringify({ id: 33, method: "tradeskillmaster.wake", params: {} }));
    await wakeJoin;
    expect([...callbacks.values()].some((cb) => cb.ms === 5000 || cb.ms === 60000)).toBe(false);
    const disconnected = new Promise<void>((resolve) => { retryScheduled = resolve; });
    socket.send("41");
    await disconnected;
    expect([...callbacks.values()].some((cb) => cb.ms === 4500)).toBe(true);
    rejectSocket = true;
    for (const [delay, nextDelay] of [[4500, 9000], [9000, 18000], [18000, 36000], [36000, 72000], [72000, 144000], [144000, 270000], [270000, 270000]]) {
      const scheduled = new Promise<void>((resolve) => { retryScheduled = resolve; });
      const entry = [...callbacks].find(([, cb]) => cb.ms === delay)!;
      expect(entry).toBeDefined();
      callbacks.delete(entry[0]);
      await entry[1].fn();
      await scheduled;
      expect([...callbacks.values()].some((cb) => cb.ms === nextDelay)).toBe(true);
    }
    rejectSocket = false;
    const reconnectJoin = new Promise<void>((resolve) => { joined = resolve; });
    for (const [id, cb] of callbacks) if (cb.ms === 270000) { callbacks.delete(id); await cb.fn(); }
    await reconnectJoin;
    for (const [random, expected] of [[0, 4000], [1, 5000]]) {
      randomValue = random!;
      const scheduled = new Promise<void>((resolve) => { retryScheduled = resolve; });
      socket.send("41");
      await scheduled;
      expect([...callbacks.values()].some((cb) => cb.ms === expected)).toBe(true);
      const nextJoin = new Promise<void>((resolve) => { joined = resolve; });
      await rpc.handleLine(JSON.stringify({ id: 37, method: "tradeskillmaster.wake", params: {} }));
      await nextJoin;
    }
    randomValue = 0.5;
    for (const path of paths) writeFileSync(path, '-- unknown line\nselect(2, ...).LoadData("AUCTIONDB_NON_COMMODITY_DATA","Tarren Mill",[[return {price=123}]]) --<AUCTIONDB_NON_COMMODITY_DATA,Tarren Mill,100,10>\n');
    // One target already has newer metadata: only stale files may change.
    writeFileSync(paths[2]!, readFileSync(paths[2]!, "utf8").replace(",100,10>", ",250,10>"));
    blob = gzipSync(new TextEncoder().encode("{price=200}"));
    await publish("realm_auctiondb", { ...event, lastModified: 150 });
    expect(readFileSync(paths[0]!, "utf8")).toContain("{price=200}");
    expect(readFileSync(paths[2]!, "utf8")).toContain("{price=123}");
    const before = readFileSync(paths[0]!, "utf8");
    for (const invalid of [
      new Uint8Array([1, 2]),
      new Uint8Array([31, 139, 0]),
      gzipSync(new TextEncoder().encode("return evil()")),
      gzipSync(new TextEncoder().encode("{bad=']]'}")),
    ]) {
      blob = invalid;
      await publish("realm_auctiondb", { ...event, lastModified: 200 });
      expect(readFileSync(paths[0]!, "utf8")).toBe(before);
    }
    blob = gzipSync(new TextEncoder().encode("return {region=42}"));
    await publish("region_auctiondb", {
      regionId: 1,
      stringType: "AUCTIONDB_REGION_STAT",
      lastModified: "300",
      url: base + "/blob",
    });
    expect((await call()).regions[0].updated).toBe(300);
    expect(readFileSync(paths[0]!, "utf8")).toContain(
      'LoadData("AUCTIONDB_REGION_STAT","EU",[[return {region=42}]])',
    );
    await publish("app_info", {
      message: { id: 7, msg: "hello]]" },
      news: [{ title: "News", content: "Content", timestamp: 99, link: "https://example.invalid" }],
    });
    expect(readFileSync(paths[0]!, "utf8")).toContain(
      'version="1.0.9",lastSync=1000,message={id=7,msg="hello\\093\\093"}',
    );
    expect(readFileSync(paths[0]!, "utf8")).toContain(
      'title="News",content="Content",timestamp=99',
    );
    expect(readFileSync(paths[0]!, "utf8").split("\n").find((line) => line.includes('--<APP_INFO,'))).toBe(
      'select(2, ...).LoadData("APP_INFO","Global",[[return {version="1.0.9",lastSync=1000,message={id=7,msg="hello\\093\\093"},news={{title="News",content="Content",timestamp=99,link="https://example.invalid"}}}]]) --<APP_INFO,Global,1000>',
    );
    // A directory at the temp path blocks creating the temp file; the previous file stays intact.
    const saved = readFileSync(paths[0]!, "utf8");
    mkdirSync(paths[0]! + ".wowdeck-tmp");
    blob = gzipSync(new TextEncoder().encode("{price=999}"));
    await publish("realm_shopping", { ...event, lastModified: 400 });
    expect(readFileSync(paths[0]!, "utf8")).toBe(saved);
    expect(readFileSync(paths[1]!, "utf8")).toContain("{price=999}");
    rmSync(paths[0]! + ".wowdeck-tmp", { recursive: true, force: true });
    await publish("app_info", {});
    expect(readFileSync(paths[0]!, "utf8")).toContain("{price=999}");
    expect(existsSync(paths[0]! + ".wowdeck-tmp")).toBe(false);
    // A temp file left by an interrupted write (power loss, restart) doesn't block the next flush.
    writeFileSync(paths[0]! + ".wowdeck-tmp", "half-written");
    blob = gzipSync(new TextEncoder().encode("{region=310}"));
    await publish("region_auctiondb", { regionId: 1, stringType: "AUCTIONDB_REGION_STAT", lastModified: 310, url: base + "/blob" });
    expect(readFileSync(paths[0]!, "utf8")).toContain("{region=310}");
    expect(existsSync(paths[0]! + ".wowdeck-tmp")).toBe(false);
    // A leftover temp link is removed as a link; what it points to is untouched.
    const outside = join(dir, "outside.lua");
    writeFileSync(outside, "-- not ours\n");
    symlinkSync(outside, paths[0]! + ".wowdeck-tmp");
    blob = gzipSync(new TextEncoder().encode("{region=320}"));
    await publish("region_auctiondb", { regionId: 1, stringType: "AUCTIONDB_REGION_STAT", lastModified: 320, url: base + "/blob" });
    expect(readFileSync(paths[0]!, "utf8")).toContain("{region=320}");
    expect(readFileSync(outside, "utf8")).toBe("-- not ours\n");
    // Freshness is the scan's time: newer historical data doesn't count.
    blob = gzipSync(new TextEncoder().encode("{history=1}"));
    await publish("region_auctiondb", { regionId: 1, stringType: "AUCTIONDB_REGION_HISTORICAL", lastModified: 900, url: base + "/blob" });
    expect(readFileSync(paths[0]!, "utf8")).toContain("{history=1}");
    expect((await call()).regions).toEqual([{ id: 1, name: "EU", updated: 320 }]);
    expect(() => lstatSync(paths[0]! + ".wowdeck-tmp")).toThrow();
    // A non-empty directory at the data file fails the write; the failure path removes a
    // leftover temp file, keeps the pending entries, and doesn't stop the independent target.
    // (The read fails before rename here; a rename-only failure isn't reachable without root.)
    blob = gzipSync(new TextEncoder().encode("{region=330}"));
    const queued = new Promise<void>((resolve) => { ack = resolve; });
    socket.send("42" + JSON.stringify(["region_auctiondb", { regionId: 1, stringType: "AUCTIONDB_REGION_STAT", lastModified: 330, url: base + "/blob" }]));
    socket.send("2");
    await queued;
    await call();
    const good = readFileSync(paths[0]!, "utf8");
    rmSync(paths[0]!);
    mkdirSync(join(paths[0]!, "occupied"), { recursive: true });
    writeFileSync(paths[0]! + ".wowdeck-tmp", "half-written");
    await flush();
    expect(existsSync(join(paths[0]!, "occupied"))).toBe(true);
    expect(() => lstatSync(paths[0]! + ".wowdeck-tmp")).toThrow();
    expect(readFileSync(paths[1]!, "utf8")).toContain("{region=330}");
    rmSync(paths[0]!, { recursive: true, force: true });
    writeFileSync(paths[0]!, good);
    await publish("app_info", {});
    expect(readFileSync(paths[0]!, "utf8")).toContain("{region=330}");
    // Rejoining reloads the account list and prunes only dropped realm keys.
    follows = [{ realmId: 1, auctionHouseType: "ALL" }];
    const tokenJoin = new Promise<void>((resolve) => { joined = resolve; });
    await auth.restore();
    await tokenJoin;
    await data.ready;
    await flush();
    expect(readFileSync(paths[0]!, "utf8")).not.toContain("|Connected");
    expect(readFileSync(paths[0]!, "utf8")).toContain("-- unknown line\n");
    expect((await call()).realms).toMatchObject([{ id: 1, name: "Tarren Mill", updated: 400 }, { id: 2, followed: false }]);
    candidates = [{ realmId: 1, auctionHouseType: "ALL" }, ...await Bun.file(join(import.meta.dir, "fixtures/tsm/discovery.json")).json()];
    follows.push(...Array.from({ length: 9 }, (_, n) => ({ realmId: 100 + n, auctionHouseType: "ALL" })));
    await auth.restore();
    await data.ready;
    expect((await call()).followedCount).toBe(10);
    expect((await call()).realms[1]).toMatchObject({ followed: false });
    await rpc.handleLine(JSON.stringify({ id: 2, method: "tradeskillmaster.setFollow", params: { realmId: 2, auctionHouseType: "ALL", followed: true } }));
    expect(response.error).toBeUndefined();
    expect(response.result.followedCount).toBe(11);
    expect(response.result.realms[1]).toMatchObject({ followed: true, owned: true, declined: false });
    rejectDelete = true;
    await rpc.handleLine(JSON.stringify({ id: 20, method: "tradeskillmaster.setFollow", params: { realmId: 2, auctionHouseType: "ALL", followed: false } }));
    expect(response.error).toBeDefined();
    expect((await call()).realms[1]).toMatchObject({ followed: true, owned: true, declined: false });
    rejectDelete = false;
    await rpc.handleLine(JSON.stringify({ id: 3, method: "tradeskillmaster.setFollow", params: { realmId: 2, auctionHouseType: "ALL", followed: false } }));
    expect(response.error).toBeUndefined();
    await flush();
    expect((await call()).realms[1]).toMatchObject({ followed: false, declined: true });
    await rpc.handleLine(JSON.stringify({ id: 4, method: "tradeskillmaster.setFollow", params: { realmId: 3, auctionHouseType: "ALL", followed: true } }));
    expect(response.error).toBeDefined();
    expect((await call()).followedCount).toBe(10);
    await auth.signOut();
    const restartedAuth = new TradeSkillMasterAuth(dir, "1", registry, { authorize: base, token: base, revoke: base });
    const restarted = new TradeSkillMasterData(restartedAuth, new TradeSkillMasterProvider(restartedAuth), store, dir, () => {}, () => candidates);
    expect((await restarted.destination("active")).realms[1]).toMatchObject({ declined: true, followed: false });
    registry.setEnabled("TradeSkillMaster", true);
    writeFileSync(join(dir, "tsm-refresh-token"), "fixture");
    await auth.restore();
    await data.ready;
    await rpc.handleLine(JSON.stringify({ id: 5, method: "tradeskillmaster.setFollow", params: { realmId: 2, auctionHouseType: "ALL", followed: true } }));
    expect(response.result.realms[1]).toMatchObject({ declined: false, owned: true });
    // Repeated follow preserves external ownership and never sends a duplicate POST.
    const beforePosts = posts;
    await rpc.handleLine(JSON.stringify({ id: 21, method: "tradeskillmaster.setFollow", params: { realmId: 1, auctionHouseType: "ALL", followed: true } }));
    expect(response.result.realms[0]).toMatchObject({ owned: false });
    expect(posts).toBe(beforePosts);
    registry.setEnabled("TradeSkillMaster", false);
    await rpc.handleLine(JSON.stringify({ id: 22, method: "tradeskillmaster.setFollow", params: { realmId: 2, auctionHouseType: "ALL", followed: false } }));
    expect(response.error).toBeDefined();
    registry.setEnabled("TradeSkillMaster", true);
    // Concurrent identical requests must observe the first mutation's refreshed list.
    await rpc.handleLine(JSON.stringify({ id: 23, method: "tradeskillmaster.setFollow", params: { realmId: 2, auctionHouseType: "ALL", followed: false } }));
    const beforeConcurrent = posts;
    await Promise.all([24, 25].map((id) => rpc.handleLine(JSON.stringify({ id, method: "tradeskillmaster.setFollow", params: { realmId: 2, auctionHouseType: "ALL", followed: true } }))));
    expect(posts).toBe(beforeConcurrent + 1);
    // A failed reload after a successful mutation must not invite a duplicate write.
    failReload = true;
    await rpc.handleLine(JSON.stringify({ id: 26, method: "tradeskillmaster.setFollow", params: { realmId: 2, auctionHouseType: "ALL", followed: false } }));
    expect(response.error).toBeDefined();
    failReload = false;
    await rpc.handleLine(JSON.stringify({ id: 27, method: "tradeskillmaster.setFollow", params: { realmId: 2, auctionHouseType: "ALL", followed: true } }));
    expect(response.error).toBeUndefined();
    expect(response.result.realms[1]).toMatchObject({ followed: true, owned: true, declined: false });
    store.setInstallations([...installations, { ...installations[0]!, id: "classic", clientType: 2, location: join(dir, "_classic_era_") }]);
    showClassic = true;
    follows.push({ id: "external-classic", realmId: 4, auctionHouseType: "HORDE" });
    await auth.restore();
    await data.ready;
    expect((await call()).realms.every((r: any) => r.id !== 4)).toBe(true);
    await rpc.handleLine(JSON.stringify({ id: 28, method: "tradeskillmaster.destination", params: { installationId: "classic" } }));
    expect(response.result).toMatchObject({ followedCount: 12, realms: [{ id: 4, auctionHouseType: "HORDE", followed: true, owned: false }] });
    expect(response.result.realms).toHaveLength(1);
    showClassic = false;
    follows = follows.filter((f) => f.realmId !== 4);
    await auth.restore();
    await data.ready;
    // A newly discovered Retail character is followed without any TSM SavedVariables.
    const character = join(installations[1]!.location, "WTF/Account/TEST/Tarren Mill/Hero");
    mkdirSync(character, { recursive: true });
    writeFileSync(join(installations[1]!.location, "WTF/Config.wtf"), 'SET portal "EU"\n');
    utimesSync(character, 1234, 1234);
    follows = follows.filter((f) => f.realmId !== 1);
    await auth.restore();
    await data.ready;
    expect((await call()).realms[0]).toMatchObject({ id: 2 });
    expect((await call()).realms.find((r: any) => r.id === 1)).toMatchObject({ followed: true, owned: true });
    const periodic = [...callbacks].find(([, cb]) => cb.ms === 900000)!;
    expect(periodic).toBeDefined();
    callbacks.delete(periodic[0]);
    await periodic[1].fn();
    expect([...callbacks.values()].some((cb) => cb.ms === 1500)).toBe(true);
    await flush();
    expect(readFileSync(paths[0]!, "utf8")).toContain('--<APP_INFO,Global,1000>');
    const beforeStop = new Promise<void>((resolve) => { joined = resolve; });
    await rpc.handleLine(JSON.stringify({ id: 35, method: "tradeskillmaster.wake", params: {} }));
    await beforeStop;
    blocked = true;
    const stoppingDownloads = new Promise<void>((resolve) => { fourStarted = resolve; });
    for (let n = 0; n < 6; n++) socket.send("42" + JSON.stringify(["realm_auctiondb", { ...event, lastModified: 999 + n }]));
    await stoppingDownloads;
    const downloadsAtDisable = downloads;
    const stopped = new Promise<void>((resolve) => { retryScheduled = resolve; });
    socket.close();
    await stopped;
    await rpc.handleLine(JSON.stringify({ id: 34, method: "providers.setEnabled", params: { providerId: "TradeSkillMaster", enabled: false } }));
    expect(response.error).toBeUndefined();
    blocked = false;
    for (const release of releases.splice(0)) release();
    await call();
    expect(downloads).toBe(downloadsAtDisable);
    expect([...callbacks.values()].some((cb) => cb.ms === 1500)).toBe(false);
    expect([...callbacks.values()].some((cb) => cb.ms === 5000)).toBe(false);
    expect(await diagnostics()).toMatchObject({ enabled: false, signedIn: false, connected: false });
    // Catalogue and per-file timestamps survive a disconnected engine restart.
    const offlineAuth = new TradeSkillMasterAuth(dir, "1", registry, {
      authorize: base,
      token: base,
      revoke: base,
    });
    const offline = new TradeSkillMasterData(
      offlineAuth,
      new TradeSkillMasterProvider(offlineAuth),
      store,
      dir,
      () => {},
      () => candidates,
    );
    expect(await offline.destination("active")).toMatchObject({
      followedCount: 11,
      realms: [{ id: 2, declined: false, followed: true, owned: true }, { id: 1, name: "Tarren Mill", updated: 400 }, { id: 3, followed: false }],
    });
    for (const secret of [tokens.access_token, "fixture-player", "Tarren Mill", base, "/blob"]) expect(logs.join("\n")).not.toContain(secret);
  } finally {
    console.error = originalError;
    await auth.signOut();
    mock.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every committed AppHelper folder change refreshes auction data through RPC", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsm-folders-"));
  const callbacks = new Map<number, { fn: () => void | Promise<void>; ms: number }>();
  let timer = 0;
  const recorded = await Bun.file(join(import.meta.dir, "fixtures/tsm/auction.json")).json();
  const tokens = await Bun.file(join(import.meta.dir, "fixtures/tsm/token.json")).json();
  const realm = recorded.realm;
  let helperVersion = "4.15";
  let price = 100;
  let socket: any;
  let opened = 0;
  let onAck: (ws: unknown) => void = () => {};
  const frame = (name: string, payload: object) => "42" + JSON.stringify([name, payload]);
  const mock = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/socket" && server.upgrade(req)) return;
      if (url.pathname === "/blob") return new Response(gzipSync(new TextEncoder().encode(`return {price=${price}}`)));
      if (url.pathname === "/helper.zip")
        return new Response(zipSync({ "TradeSkillMaster_AppHelper/TradeSkillMaster_AppHelper.toc": new TextEncoder().encode(`## Interface: 110200\n## Title: Helper\n## Version: v${url.searchParams.get("v")}\n`) }));
      if (url.pathname === "/realms") return Response.json({ items: [realm] });
      if (url.pathname === "/regions") return Response.json({ items: [realm.region] });
      if (url.pathname === "/versions") return Response.json([{ folder: "_retail_", label: "Retail" }]);
      if (url.pathname === "/follows") return Response.json({ items: [{ realmId: 1, auctionHouseType: "ALL" }], metadata: { totalPages: 1 } });
      return Response.json(tokens);
    },
    websocket: {
      open(ws) {
        opened++;
        ws.send("0{}");
      },
      message(ws, msg) {
        if (msg === "40") {
          // As TradeSkillMaster does: each connection gets the releases and the current data.
          socket = ws;
          ws.send("40{}");
          ws.send(frame("addon", catalogue()));
          ws.send(frame("realm_auctiondb", event()));
          ws.send("2");
        } else if (msg === "3") onAck(ws);
      },
    },
  });
  const base = `http://127.0.0.1:${mock.port}`;
  const catalogue = () => ({ isComplete: true, data: [{ addon: "TradeSkillMaster_AppHelper", channel: "release", version: `v${helperVersion}`, url: `${base}/helper.zip?v=${helperVersion}` }] });
  const event = () => ({ ...recorded.event, lastModified: price, url: base + "/blob" });
  /** Resolves once a new connection has delivered its data. */
  const reconnected = () => {
    const previous = socket;
    return new Promise<void>((resolve) => { onAck = (ws) => { if (ws !== previous) resolve(); }; });
  };
  /** Resolves once the live connection answers: nothing reconnected. */
  const ping = () => new Promise<void>((resolve) => {
    const live = socket;
    onAck = (ws) => { if (ws === live) resolve(); };
    live.send("2");
  });
  const push = async (name: string, payload: object) => {
    socket.send(frame(name, payload));
    await ping();
  };
  const registry = new ProviderRegistry();
  const store = createStateStore(dir);
  const auth = new TradeSkillMasterAuth(dir, "1", registry, {
    authorize: base, token: base, revoke: base,
    socket: base.replace("http", "ws") + "/socket",
    realms: base + "/realms", regions: base + "/regions", gameVersions: base + "/versions", userRealms: base + "/follows",
  }, {
    now: () => 1000000,
    random: () => 0.5,
    setTimeout(fn, ms) { callbacks.set(++timer, { fn, ms }); return timer; },
    clearTimeout(id) { callbacks.delete(id as number); },
  });
  const provider = new TradeSkillMasterProvider(auth);
  registry.register(provider);
  registry.register(new FileProvider());
  registry.attachStore(store);
  registry.setEnabled("TradeSkillMaster", true);
  store.updateSettings({ keepPreviousVersions: true });
  const installation = {
    id: "retail", clientType: 0, location: join(dir, "retail"), label: "Retail", displayName: "Retail",
    selected: true, defaultAddonChannelType: 0, source: "detected" as const,
  };
  store.setInstallations([installation]);
  const addOns = join(installation.location, "Interface/AddOns");
  const tsmFile = join(addOns, "TradeSkillMaster/AppData.lua");
  const helperFile = join(addOns, "TradeSkillMaster_AppHelper/AppData.lua");
  mkdirSync(join(addOns, "TradeSkillMaster"), { recursive: true });
  writeFileSync(join(addOns, "TradeSkillMaster/TradeSkillMaster.toc"), "## Interface: 110200\n## Version: v4.15.4\n");
  const data = new TradeSkillMasterData(auth, provider, store, dir, () => {});
  let response: any;
  const rpc = new JsonlServer((line) => { response = JSON.parse(line); });
  const deps = { store, registry, tsmAuth: auth, tsmData: data, companionCoordinator: { regenerate: async () => {} }, installationService: { require: () => installation } };
  register(rpc, deps as unknown as HandlerDeps);
  const service = new AddonService(store, registry, new DownloadService(new NetworkClient(), join(dir, "downloads")), { addonsChanged() {}, operationResult() {} });
  service.onFoldersChanged = (id, folders) => data.foldersChanged(id, folders);
  registerAddons(rpc, { ...deps, service } as unknown as HandlerDeps);
  const call = async (method: string, params: object = {}) => {
    await rpc.handleLine(JSON.stringify({ id: 1, method, params }));
    expect(response.error).toBeUndefined();
    return response.result;
  };
  const runWrites = async () => {
    for (const [id, cb] of callbacks)
      if (cb.ms === 1500) {
        callbacks.delete(id);
        await cb.fn();
      }
  };
  /** Waits for the data in flight, then writes it. */
  const settle = async () => {
    await call("tradeskillmaster.destination");
    await runWrites();
  };
  const helper = () => store.addons.forInstallation(installation.id).find((a) => recordFolders(a).includes("TradeSkillMaster_AppHelper"))!;
  const text = (path: string) => readFileSync(path, "utf8");
  try {
    writeFileSync(join(dir, "tsm-refresh-token"), "fixture");
    let next = reconnected();
    await auth.restore();
    await next;
    await data.ready;
    await settle();
    expect(text(tsmFile)).toContain("{price=100}");

    // Installing AppHelper moves the target; the refresh fills its file at once.
    next = reconnected();
    expect((await call("addons.install", { providerId: "TradeSkillMaster", externalId: "TradeSkillMaster_AppHelper" })).operation.status).toBe("installed");
    await next;
    await settle();
    expect(text(helperFile)).toContain("{price=100}");

    // A failed Roll back (nothing kept) changes no folder and reconnects nothing.
    expect((await call("addons.rollback", { addonId: helper().id })).operation.status).toBe("failed");
    await ping();

    // An update, then a Roll back restoring the older folder with its stale data file.
    helperVersion = "4.16";
    await push("addon", catalogue());
    price = 200;
    next = reconnected();
    expect((await call("addons.update", { addonId: helper().id })).operation.status).toBe("updated");
    await next;
    await settle();
    expect(text(helperFile)).toContain("{price=200}");
    price = 300;
    next = reconnected();
    expect((await call("addons.rollback", { addonId: helper().id })).operation.status).toBe("installed");
    await next;
    await settle();
    expect(text(join(addOns, "TradeSkillMaster_AppHelper/TradeSkillMaster_AppHelper.toc"))).toContain("v4.15");
    expect(text(helperFile)).toContain("{price=300}");
    expect(text(helperFile)).not.toContain("{price=100}");

    // Data queued for AppHelper when it is removed: the TradeSkillMaster
    // file gets the refresh, and the removed path is dropped, not retried.
    price = 400;
    await push("realm_auctiondb", event());
    await call("tradeskillmaster.destination");
    next = reconnected();
    expect((await call("addons.remove", { addonId: helper().id })).operation.status).toBe("removed");
    await next;
    await settle();
    expect(text(tsmFile)).toContain("{price=400}");
    mkdirSync(join(addOns, "TradeSkillMaster_AppHelper"));
    writeFileSync(join(addOns, "TradeSkillMaster_AppHelper/TradeSkillMaster_AppHelper.toc"), "## Interface: 110200\n## Version: v4.15\n");
    await push("app_info", {});
    await settle();
    expect(text(helperFile)).toContain("--<APP_INFO,");
    expect(text(helperFile)).not.toContain("{price=400}");

    // Removing the hand-copied AppHelper folder refreshes the TradeSkillMaster file too.
    price = 500;
    next = reconnected();
    expect((await call("addons.removeUnmanaged", { folderName: "TradeSkillMaster_AppHelper" })).operation.status).toBe("removed");
    await next;
    await settle();
    expect(text(tsmFile)).toContain("{price=500}");

    // With the source off, a File install of AppHelper reconnects nothing.
    registry.setEnabled("TradeSkillMaster", false);
    const archive = join(dir, "helper.zip");
    writeFileSync(archive, zipSync({ "TradeSkillMaster_AppHelper/TradeSkillMaster_AppHelper.toc": new TextEncoder().encode("## Interface: 110200\n## Version: v4.15\n") }));
    expect((await call("addons.install", { providerId: "File", externalId: archive })).operation.status).toBe("installed");
    await ping();
    registry.setEnabled("TradeSkillMaster", true);

    // Signed out, a removal reconnects nothing: signing back in is the only new connection.
    await auth.signOut();
    const before = opened;
    expect((await call("addons.remove", { addonId: helper().id })).operation.status).toBe("removed");
    registry.setEnabled("TradeSkillMaster", true);
    writeFileSync(join(dir, "tsm-refresh-token"), "fixture");
    next = reconnected();
    await auth.restore();
    await next;
    await data.ready;
    expect(opened).toBe(before + 1);
    await settle();

    // Data queued for an installation that is then removed is dropped.
    price = 600;
    await push("realm_auctiondb", event());
    await call("tradeskillmaster.destination");
    store.setInstallations([]);
    await runWrites();
    store.setInstallations([installation]);
    await push("app_info", {});
    await settle();
    expect(text(tsmFile)).toContain("--<APP_INFO,");
    expect(text(tsmFile)).not.toContain("{price=600}");
  } finally {
    await auth.signOut();
    mock.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

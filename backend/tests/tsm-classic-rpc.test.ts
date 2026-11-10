import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("all Classic account follows deliver isolated faction and region data to inactive installations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsm-classic-"));
  const fixtures = await Bun.file(join(import.meta.dir, "fixtures/tsm/classic.json")).json();
  const tokens = await Bun.file(join(import.meta.dir, "fixtures/tsm/token.json")).json();
  const realms = fixtures.map((f: any, n: number) => ({
    realmId: n + 1,
    localizedName: f.name,
    regionId: n + 1,
    region: { regionId: n + 1, gameVersion: f.version, regionPrefix: "eu" },
    auctionHouses: [
      { type: "Horde", auctionHouseId: 10 + n },
      { type: "Alliance", auctionHouseId: 110 + n },
    ],
  }));
  realms.push({ ...realms[0], realmId: 99, localizedName: "Verbunden" });
  let follows = realms.flatMap((r: any) =>
    ["HORDE", "ALLIANCE"].map((auctionHouseType) => ({ realmId: r.realmId, auctionHouseType })),
  );
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let timer = 0;
  let socket: any;
  let joined!: () => void;
  const ready = new Promise<void>((r) => {
    joined = r;
  });
  let ack = () => {};
  const mock = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) {
      const path = new URL(req.url).pathname;
      if (path === "/socket" && server.upgrade(req)) return;
      if (path === "/realms") return Response.json({ items: realms });
      if (path === "/regions")
        return Response.json({ items: realms.slice(0, -1).map((r: any) => r.region) });
      if (path === "/versions") return Response.json([]);
      if (path === "/follows") return Response.json({ items: follows });
      if (path === "/blob")
        return new Response(gzipSync(new TextEncoder().encode("return {price=123}")));
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
      setTimeout(fn, ms) {
        timers.set(++timer, { fn, ms });
        return timer;
      },
      clearTimeout(id) {
        timers.delete(id as number);
      },
    },
  );
  const provider = new TradeSkillMasterProvider(auth);
  registry.register(provider);
  registry.attachStore(store);
  registry.setEnabled("TradeSkillMaster", true);
  const installations = [...new Set<string>(fixtures.map((f: any) => f.folder))].flatMap((folder) =>
    ["helper", "tsm"].map((kind) => ({
      id: folder + kind,
      location: join(dir, kind, folder),
      clientType: 2,
      label: folder,
      displayName: folder,
      selected: false,
      defaultAddonChannelType: 0,
      source: "detected" as const,
    })),
  );
  store.setInstallations(installations);
  const paths = installations.map((i) =>
    join(
      i.location,
      "Interface/AddOns",
      i.id.endsWith("helper") ? "TradeSkillMaster_AppHelper" : "TradeSkillMaster",
      "AppData.lua",
    ),
  );
  paths.forEach((path) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "-- future unknown line\n");
  });
  for (const i of installations) {
    const root = join(i.location, "WTF/Account/TEST/SavedVariables");
    mkdirSync(root, { recursive: true });
    const scopes = fixtures
      .filter((f: any) => i.location.endsWith(f.folder))
      .map((f: any) => '"Horde - ' + f.name + '"')
      .join(",");
    writeFileSync(
      join(root, "TradeSkillMaster.lua"),
      "TradeSkillMasterDB = { _scopeKeys = { factionrealm = {" + scopes + "} } }",
    );
    writeFileSync(
      join(root, "TradeSkillMaster_AppHelper.lua"),
      'TradeSkillMaster_AppHelperDB = { region = "EU" }',
    );
  }
  const data = new TradeSkillMasterData(auth, provider, store, dir, () => {});
  let response: any;
  const rpc = new JsonlServer((line) => {
    response = JSON.parse(line);
  });
  register(rpc, {
    store,
    registry,
    tsmAuth: auth,
    tsmData: data,
    installationService: { require: (id: string) => installations.find((i) => i.id === id) },
  } as unknown as HandlerDeps);
  const call = async (id = installations[0]!.id) => {
    await rpc.handleLine(
      JSON.stringify({
        id: 1,
        method: "tradeskillmaster.destination",
        params: { installationId: id },
      }),
    );
    expect(response.error).toBeUndefined();
    return response.result;
  };
  const flush = () => {
    for (const [id, cb] of timers)
      if (cb.ms === 1500) {
        timers.delete(id);
        cb.fn();
      }
  };
  const publish = async (name: string, payload: object) => {
    const done = new Promise<void>((r) => {
      ack = r;
    });
    socket.send(
      "42" + JSON.stringify([name, { ...payload, lastModified: 100, url: base + "/blob" }]),
    );
    socket.send("2");
    await done;
    await call();
    flush();
  };
  try {
    writeFileSync(join(dir, "tsm-refresh-token"), "fixture");
    await auth.restore();
    await ready;
    await data.ready;
    expect((await call()).realms[0].updated).toBeNull();
    for (let n = 0; n < fixtures.length; n++) {
      for (const auctionHouseType of ["HORDE", "ALLIANCE"]) {
        await publish("realm_auctiondb", {
          realmId: n + 1,
          auctionHouseType,
          stringType: "AUCTIONDB_NON_COMMODITY_DATA",
        });
        await publish("realm_shopping", {
          realmId: n + 1,
          auctionHouseType,
          stringType: "SHOPPING",
        });
      }
      await publish("region_auctiondb", { regionId: n + 1, stringType: "AUCTIONDB_REGION_STAT" });
    }
    for (let p = 0; p < paths.length; p++) {
      const content = readFileSync(paths[p]!, "utf8");
      expect(content).toContain("-- future unknown line\n");
      for (const f of fixtures) {
        if (installations[p]!.location.endsWith(f.folder)) {
          expect(content).toContain(`SHOPPING,${f.name}-Horde`);
          expect(content).toContain(`${f.name}-Alliance`);
          expect(content).toContain(",100,");
          expect(content).toContain(`AUCTIONDB_REGION_STAT,${f.key},100>`);
        } else expect(content).not.toContain(f.key);
      }
      const destination = await call(installations[p]!.id);
      expect(destination.realms.length).toBeGreaterThan(0);
      expect(destination.realms.every((r: any) => r.auctionHouseType === "HORDE")).toBe(true);
      expect(destination.regions.length).toBeGreaterThan(0);
      expect(destination.realms.every((r: any) => r.updated === 100)).toBe(true);
      expect(destination.regions.every((r: any) => r.updated === 100)).toBe(true);
    }
    rmSync(join(installations[0]!.location, "WTF"), { recursive: true });
    expect((await call()).realms).toEqual([]);
    expect((await call()).regions).toEqual([]);
    expect((await call(installations[1]!.id)).realms.length).toBeGreaterThan(0);
    expect((await call()).followedCount).toBe(follows.length);
    expect(readFileSync(paths[0]!, "utf8")).toContain('ipairs({"Éra-Horde","Verbunden-Horde"})');
    expect(readFileSync(paths[0]!, "utf8")).not.toContain('"Éra-Horde","Verbunden-Alliance"');
    follows = follows.filter((f: any) => f.auctionHouseType !== "HORDE");
    await auth.restore();
    await data.ready;
    flush();
    expect(readFileSync(paths[0]!, "utf8")).not.toContain("Éra-Horde");
    expect(readFileSync(paths[0]!, "utf8")).toContain("Éra-Alliance");
    expect(readFileSync(paths[0]!, "utf8")).toContain("-- future unknown line\n");
  } finally {
    await auth.signOut();
    mock.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

import { AddonProvider, type ScanMatch } from "../src/wow/providers/addon-provider";
import type { AddonFolder } from "../src/wow/models";
import { FileProvider } from "../src/wow/providers/file/FileProvider";
import { ZipProvider } from "../src/wow/providers/zip/ZipProvider";
import { UpdateCheck } from "../src/wow/notifications/UpdateCheck";
import { CompanionSyncCoordinator } from "../src/wow/notifications/CompanionSync";
import { zipSync } from "fflate";
import { AddonService } from "../src/wow/addons/AddonService";
import { DownloadService } from "../src/wow/downloads/DownloadService";
import { NetworkClient } from "../src/wow/net/network";
import type { WowInstallation } from "../src/wow/models";
import { Catalogue as SourceCatalogue } from "../src/wow/catalogue/Catalogue";
import type { Toc } from "../src/wow/toc/toc";
import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlServer } from "../src/bridge/jsonl";
import { register } from "../src/api/handlers/addons";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import {
  TradeSkillMasterAuth,
  TradeSkillMasterProvider,
} from "../src/wow/tsm/TradeSkillMasterAuth";
import { FaultInjectingFs } from "../src/wow/fs/StageFs";
import { createStateStore } from "../src/wow/storage/StateStore";
import type { HandlerDeps } from "../src/api/handlers/deps";

test.each(
  Array.from({ length: 11 }, (_, clientType) => [clientType, false] as [number, boolean]).concat(
    Array.from({ length: 11 }, (_, clientType) => [clientType, true] as [number, boolean]),
  ),
)("addon RPC operations for flavor %s with beta entitlement %s", async (clientType, beta) => {
  const dir = mkdtempSync(join(tmpdir(), "tsm-addons-"));
  const tokens = await Bun.file(join(import.meta.dir, "fixtures/tsm/token.json")).json();
  tokens.access_token = `e30.${Buffer.from(JSON.stringify({ preferred_username: "fixture-player", realm_access: { roles: beta ? ["channel/beta"] : [] } })).toString("base64url")}.fixture`;
  let joined!: () => void;
  const recorded = await Bun.file(join(import.meta.dir, "fixtures/tsm/addon.json")).json();
  let version = "4.15.4";
  let broken = false;
  let ready = new Promise<void>((resolve) => {
    joined = resolve;
  });
  const mock = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) {
      if (new URL(req.url).pathname === "/socket.io/") {
        expect(req.headers.get("Authorization")).toBe(tokens.access_token);
        if (server.upgrade(req)) return;
      }
      const url = new URL(req.url);
      if (url.pathname.endsWith(".zip")) {
        expect(req.headers.get("Authorization")).toBeNull();
        const name =
          url.pathname !== "/helper.zip" ? "TradeSkillMaster" : "TradeSkillMaster_AppHelper";
        if (broken) return new Response("invalid zip");
        return new Response(
          zipSync({
            [`${name}/${name}_Classic.toc`]: new TextEncoder().encode(
              `## Interface: 50500\n## Version: v${name === "TradeSkillMaster" ? (url.pathname === "/beta.zip" ? "4.16" : version) : "4.15"}\n`,
            ),
            [`${name}/${name}.toc`]: new TextEncoder().encode(
              `## Title: ${name}\n## Version: v${name === "TradeSkillMaster" ? (url.pathname === "/beta.zip" ? "4.16" : version) : "4.15"}\n## Interface: 110005\n`,
            ),
          }),
        );
      }
      return Response.json(tokens);
    },
    websocket: {
      open(ws) {
        ws.subscribe("releases");
        ws.send('0{"sid":"fixture","pingInterval":25000,"pingTimeout":20000}');
      },
      message(ws, frame) {
        if (frame === "40") {
          ws.send('40{"sid":"fixture"}');
          ws.send(
            `42${JSON.stringify(["addon", recorded])}`.replaceAll(
              "https://cdn.invalid",
              `http://127.0.0.1:${mock.port}`,
            ),
          );
          ws.send("2");
        } else if (frame === "3") joined();
      },
    },
  });
  const base = `http://127.0.0.1:${mock.port}`;
  const registry = new ProviderRegistry();
  const auth = new TradeSkillMasterAuth(dir, "1", registry, {
    authorize: base,
    token: base,
    revoke: base,
    socket: base.replace("http", "ws") + "/socket.io/?EIO=4&transport=websocket",
  });
  const provider = new TradeSkillMasterProvider(auth);
  class Catalogue extends AddonProvider {
    override name = "WowUpHub" as const;
    override enabled = true;
    override isValidAddonId() { return true; }
    override async getById(id: string) {
      const result = await provider.getById(id, installation);
      return result && { ...result, providerName: this.name };
    }
    override async scan(_installation: WowInstallation, folders: AddonFolder[]) {
      const matches = new Map<string, ScanMatch>();
      for (const folder of folders) {
        const addon = await this.getById(folder.name);
        if (addon) matches.set(folder.name, { addon, latestFile: addon.files![0]! });
      }
      return matches;
    }
  }
  registry.register(new Catalogue());
  registry.register(provider);
  registry.register(new FileProvider());
  const zip = new ZipProvider();
  zip.isValidAddonId = (id) => id.startsWith("http://127.0.0.1:"); // local CDN boundary
  registry.register(zip);
  const fs = new FaultInjectingFs();
  const store = createStateStore(dir, fs);
  registry.attachStore(store);
  store.updateSettings({ keepPreviousVersions: true });
  const installation: WowInstallation = {
    id: "retail",
    clientType,
    location: join(dir, "_retail_"),
    label: "Retail",
    displayName: "Retail",
    selected: true,
    defaultAddonChannelType: 2,
    source: "detected",
  };
  mkdirSync(join(installation.location, "Interface/AddOns"), { recursive: true });
  const second = { ...installation, id: "second", location: join(dir, "second") };
  mkdirSync(join(second.location, "Interface/AddOns"), { recursive: true });
  store.setInstallations([installation, second]);
  let active = installation;
  const service = new AddonService(
    store,
    registry,
    new DownloadService(new NetworkClient(), join(dir, "downloads")),
    { addonsChanged() {}, operationResult() {} },
  );
  // Use the existing game-process seam so the RPC check is independent of /proc.
  const autoUpdate = service.autoUpdate.bind(service);
  service.autoUpdate = () => autoUpdate(async () => "not_running");
  registry.setEnabled("TradeSkillMaster", true);
  writeFileSync(join(dir, "tsm-refresh-token"), "fixture");
  let response: any;
  const rpc = new JsonlServer((line) => {
    response = JSON.parse(line);
  });
  register(rpc, {
    service,
    updateCheck: new UpdateCheck(service, new CompanionSyncCoordinator(service)),
    installationService: { require: (id?: string) => id === second.id ? second : active },
  } as unknown as HandlerDeps);
  const call = async (method: string, params = {}) => {
    await rpc.handleLine(JSON.stringify({ id: 1, method, params }));
    if (response.error) throw new Error(JSON.stringify(response.error));
    return response.result;
  };
  try {

    for (const name of ["TradeSkillMaster", "TradeSkillMaster_AppHelper"]) {
      const folder = join(installation.location, "Interface/AddOns", name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, name + ".toc"), "## Interface: 110005\n## Version: v4.0\n");
      writeFileSync(join(folder, "keep.lua"), "existing content");
    }
    const seed = join(dir, "seed.zip");
    writeFileSync(seed, zipSync({ "TradeSkillMaster/TradeSkillMaster.toc": new TextEncoder().encode("## Interface: 110005\n## Version: v4.0\n"), "TradeSkillMaster/keep.lua": new TextEncoder().encode("existing content"), "TradeSkillMaster_AppHelper/TradeSkillMaster_AppHelper.toc": new TextEncoder().encode("## Interface: 110005\n## Version: v4.0\n"), "TradeSkillMaster_AppHelper/keep.lua": new TextEncoder().encode("existing content") }));
    expect((await call("addons.install", { providerId: "File", externalId: seed })).operation.status).toBe("installed");
    const updatedSeed = join(dir, "updated-seed.zip");
    writeFileSync(updatedSeed, zipSync({ "TradeSkillMaster/TradeSkillMaster.toc": new TextEncoder().encode("## Interface: 110005\n## Version: v4.0\n"), "TradeSkillMaster/keep.lua": new TextEncoder().encode("existing content"), "TradeSkillMaster/new.lua": new TextEncoder().encode("new content"), "TradeSkillMaster_AppHelper/TradeSkillMaster_AppHelper.toc": new TextEncoder().encode("## Interface: 110005\n## Version: v4.0\n"), "TradeSkillMaster_AppHelper/keep.lua": new TextEncoder().encode("existing content") }));
    expect((await call("addons.install", { providerId: "File", externalId: updatedSeed })).operation.status).toBe("installed");
    active = second;
    expect((await call("addons.install", { providerId: "File", externalId: seed })).operation.status).toBe("installed");
    active = installation;
    await auth.restore();
    await ready;
    await call("addons.refresh", { installationId: second.id });
    active = second;
    expect((await call("addons.list")).addons.map((a: any) => a.providerId)).toEqual(["TradeSkillMaster", "TradeSkillMaster"]);
    active = installation;
    await call("addons.refresh");
    const adopted = (await call("addons.list")).addons;
    expect(adopted).toHaveLength(2);
    expect(adopted.every((a: any) => a.providerId === "TradeSkillMaster")).toBe(true);
    for (const name of ["TradeSkillMaster", "TradeSkillMaster_AppHelper"]) {
      expect(readFileSync(join(installation.location, "Interface/AddOns", name, "keep.lua"), "utf8")).toBe("existing content");
    }
    const rollback = await call("addons.rollback", { addonId: adopted.find((a: any) => a.previousVersion).id });
    expect(rollback.operation.status).toBe("failed");
    expect(JSON.stringify(rollback.operation)).toContain("TradeSkillMaster installs this addon");
    expect(readFileSync(join(installation.location, "Interface/AddOns/TradeSkillMaster/new.lua"), "utf8")).toBe("new content");
    for (const addon of adopted) {
      const name = addon.externalId;
      const archive = join(dir, name + ".zip");
      writeFileSync(archive, zipSync({ [name + "/" + name + ".toc"]: new TextEncoder().encode("## Version: 99\n## Interface: 110005\n") }));
      for (const [providerId, externalId] of [["WowUpHub", name], ["File", archive], ["Zip", base + (name === "TradeSkillMaster" ? "/tsm.zip" : "/helper.zip")]]) {
        if (providerId === "WowUpHub") {
          await expect(call("addons.install", { providerId, externalId })).rejects.toThrow("TradeSkillMaster installs this addon");
        } else {
          const refused = await call("addons.install", { providerId, externalId });
          expect(refused.operation.status).toBe("failed");
          expect(JSON.stringify(refused.operation)).toContain("TradeSkillMaster installs this addon");
        }
        await expect(call("addons.changeSource", { addonId: addon.id, providerId, externalId })).rejects.toThrow("TradeSkillMaster installs this addon");
        await expect(call("addons.adopt", { folderName: name, providerId, externalId })).rejects.toThrow("TradeSkillMaster installs this addon");
      }
      expect(readFileSync(join(installation.location, "Interface/AddOns", name, "keep.lua"), "utf8")).toBe("existing content");
    }
    registry.setEnabled("TradeSkillMaster", false);
    active = second;
    expect((await call("addons.list")).addons.every((a: any) => a.sourceOff)).toBe(true);
    for (const name of ["TradeSkillMaster", "TradeSkillMaster_AppHelper"]) expect(readFileSync(join(second.location, "Interface/AddOns", name, "keep.lua"), "utf8")).toBe("existing content");
    active = installation;
    expect((await call("addons.list")).addons.every((a: any) => a.sourceOff)).toBe(true);
    expect((await call("addons.install", { providerId: "File", externalId: join(dir, "TradeSkillMaster.zip") })).operation.status).toBe("installed");
    registry.setEnabled("TradeSkillMaster", true);
    await call("addons.refresh");
    // Change source on a copy from another source offers TradeSkillMaster:
    // found by its TOC's folder, as it has no search.
    const toc = { filePath: join(installation.location, "Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc"), dependencyList: [], optionalDependencyList: [], interface: [] } as unknown as Toc;
    const sources = await new SourceCatalogue(registry).findSources({ installation, folderName: "TradeSkillMaster", toc, queries: ["TradeSkillMaster"], ownProvider: "File" });
    expect(sources.results.map((r) => [r.providerId, r.externalId])).toContainEqual(["TradeSkillMaster", "TradeSkillMaster"]);
    for (const addon of adopted) await call("addons.remove", { addonId: addon.id });
    for (const name of ["TradeSkillMaster", "TradeSkillMaster_AppHelper"]) {
      const folder = join(installation.location, "Interface/AddOns", name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, name + ".toc"), "## Interface: 110005\n## Version: @project-version@\n");
      if (name === "TradeSkillMaster") mkdirSync(join(folder, ".git"));
    }
    await call("addons.refresh");
    expect((await call("addons.list")).addons.every((a: any) => !a.providerId)).toBe(true);
    for (const name of ["TradeSkillMaster", "TradeSkillMaster_AppHelper"]) {
      const protectedInstall = await call("addons.install", { providerId: "TradeSkillMaster", externalId: name });
      expect(protectedInstall.operation.status).toBe("failed");
      expect(JSON.stringify(protectedInstall.operation)).toContain("developer addon");
      expect(readFileSync(join(installation.location, "Interface/AddOns", name, name + ".toc"), "utf8")).toContain("@project-version@");
    }
    for (const name of ["TradeSkillMaster", "TradeSkillMaster_AppHelper"]) rmSync(join(installation.location, "Interface/AddOns", name), { recursive: true });
    // Each commit reports its own folders, AppHelper's as a dependency too;
    // a callback that throws is logged and changes nothing.
    const changed: string[][] = [];
    service.onFoldersChanged = (id, folders) => {
      changed.push([id, ...folders]);
      throw new Error("auction refresh failed");
    };
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
    let installed: any;
    try {
      const installing = call("addons.install", {
        providerId: "TradeSkillMaster",
        externalId: "TradeSkillMaster",
      });
      await ready;
      installed = await installing;
    } finally {
      console.error = originalError;
    }
    expect(changed).toEqual([[installation.id, "TradeSkillMaster"], [installation.id, "TradeSkillMaster_AppHelper"]]);
    expect(logs.filter((line) => line.includes("auction refresh failed"))).toHaveLength(2);
    service.onFoldersChanged = (id, folders) => { changed.push([id, ...folders]); };
    expect(installed.operation.status).toBe("installed");
    expect(installed.addon.version).toBe("4.15.4");
    const list = await call("addons.list");
    expect(JSON.stringify(list)).toContain("TradeSkillMaster_AppHelper");
    const library = list.addons.find((a: any) => a.externalId === "TradeSkillMaster_AppHelper");
    expect(library.installedAsDependency).toBe(true);
    expect(library.neededBy).toHaveLength(1);
    expect(
      existsSync(
        join(
          installation.location,
          "Interface/AddOns/TradeSkillMaster_AppHelper/TradeSkillMaster_AppHelper.toc",
        ),
      ),
    ).toBe(true);
    expect(installed.addon.allowedChannels).toEqual(beta ? ["stable", "beta"] : ["stable"]);
    if (beta) {
      expect(
        (await call("addons.setChannel", { addonId: installed.addon.id, channel: "beta" })).addon
          .channel,
      ).toBe("beta");
      expect((await call("addons.list")).addons.find((a: any) => a.id === installed.addon.id).version).toBe("4.16");
      await call("addons.setChannel", { addonId: installed.addon.id, channel: "stable" });
    } else {
      await expect(
        call("addons.setChannel", { addonId: installed.addon.id, channel: "beta" }),
      ).rejects.toThrow();
    }
    version = "4.15.5";
    ready = new Promise<void>((resolve) => {
      joined = resolve;
    });
    mock.publish(
      "releases",
      `42${JSON.stringify([
        "addon",
        {
          isComplete: true,
          data: [
            {
              addon: "TradeSkillMaster",
              channel: "release",
              version: "v4.15.5",
              url: `${base}/tsm.zip`,
            },
            {
              addon: "TradeSkillMaster_AppHelper",
              channel: "release",
              version: "v4.15",
              url: `${base}/helper.zip`,
            },
          ],
        },
      ])}`,
    );
    mock.publish("releases", "2");
    await ready;
    const refreshed = await call("addons.refresh", {});
    expect(refreshed.addons.find((a: any) => a.id === installed.addon.id).updateAvailable).toBe(
      true,
    );
    const tocPath = join(installation.location, "Interface/AddOns/TradeSkillMaster/TradeSkillMaster.toc");
    const previousToc = readFileSync(tocPath);
    broken = true;
    changed.length = 0;
    expect((await call("addons.update", { addonId: installed.addon.id })).operation.status).toBe(
      "failed",
    );
    expect(changed).toEqual([]);
    expect(
      (await call("addons.list")).addons.find((a: any) => a.id === installed.addon.id).version,
    ).toBe("4.15.4");
    expect(readFileSync(tocPath)).toEqual(previousToc);
    broken = false;
    // The normal cross-installation check respects both the global setting
    // and the individual addon's pause before installing a socket release.
    store.updateSettings({ autoUpdate: false });
    await call("addons.updateSummary", { refresh: true });
    expect((await call("addons.list")).addons.find((a: any) => a.id === installed.addon.id).version).toBe("4.15.4");
    store.updateSettings({ autoUpdate: true });
    await call("addons.setAutoUpdatePaused", { addonId: installed.addon.id, paused: true });
    await call("addons.updateSummary", { refresh: true });
    expect((await call("addons.list")).addons.find((a: any) => a.id === installed.addon.id).version).toBe("4.15.4");
    await call("addons.setAutoUpdatePaused", { addonId: installed.addon.id, paused: false });
    await call("addons.updateSummary", { refresh: true });
    expect((await call("addons.list")).addons.find((a: any) => a.id === installed.addon.id).version).toBe("4.15.5");
    expect(store.settings.lastAutoUpdate?.updated).toContain("TradeSkillMaster");
    fs.failAt("state.write", { times: 1 });
    const failedRemoval = await call("tradeskillmaster.removeAddons", { installationId: second.id });
    expect(failedRemoval.operations[0].status).toBe("failed");
    expect((await call("addons.list", { installationId: second.id })).addons.map((a: any) => a.id)).toContain(failedRemoval.operations[0].addonId);
    // Other named addons may commit independently; retry removes the remaining copy.
    const grouped = await call("tradeskillmaster.removeAddons", { installationId: second.id });
    expect(grouped.operations.every((op: any) => op.status === "removed")).toBe(true);
    expect((await call("addons.list", { installationId: second.id })).addons).toHaveLength(0);
    expect((await call("addons.list")).addons).toHaveLength(2);
    expect(existsSync(join(dir, "tsm-refresh-token"))).toBe(true);
    expect((await call("tradeskillmaster.removeAddons", { installationId: second.id })).operations).toEqual([]);
    // Helper-only and unmanaged copies still use the selected installation's remover.
    const secondAddons = join(second.location, "Interface/AddOns");
    const helperPath = join(secondAddons, "TradeSkillMaster_AppHelper");
    mkdirSync(helperPath, { recursive: true });
    writeFileSync(join(helperPath, "TradeSkillMaster_AppHelper.toc"), "## Interface: 110005\n## Version: dev\n");
    const protectedRemoval = await call("tradeskillmaster.removeAddons", { installationId: second.id });
    expect(protectedRemoval.operations[0].status).toBe("failed");
    expect(JSON.stringify(protectedRemoval)).toContain("developer addon");
    expect(existsSync(helperPath)).toBe(true);
    writeFileSync(join(helperPath, "TradeSkillMaster_AppHelper.toc"), "## Interface: 110005\n## Version: 4.15\n");
    mkdirSync(join(secondAddons, "UnrelatedLibrary"), { recursive: true });
    writeFileSync(join(secondAddons, "UnrelatedLibrary/UnrelatedLibrary.toc"), "## Interface: 110005\n");
    mkdirSync(join(helperPath, ".git"));
    const gitProtected = await call("tradeskillmaster.removeAddons", { installationId: second.id });
    expect(gitProtected.operations[0].status).toBe("failed");
    expect(existsSync(helperPath)).toBe(true);
    rmSync(join(helperPath, ".git"), { recursive: true });
    const partial = await call("tradeskillmaster.removeAddons", { installationId: second.id });
    expect(partial.operations.map((op: any) => op.status)).toEqual(["removed"]);
    expect(existsSync(helperPath)).toBe(false);
    expect(existsSync(join(secondAddons, "UnrelatedLibrary/UnrelatedLibrary.toc"))).toBe(true);
    expect((await call("addons.list")).addons).toHaveLength(2);
    mkdirSync(helperPath, { recursive: true });
    writeFileSync(join(helperPath, "TradeSkillMaster_AppHelper.toc"), "## Interface: 110005\n## Version: 4.15\n");
    fs.failAt("state.write", { times: 1 }).failAt("folder.restore");
    const recoveryRemoval = await call("tradeskillmaster.removeAddons", { installationId: second.id });
    expect(recoveryRemoval.operations[0]).toMatchObject({ status: "failed", recoveryRequired: true });
    expect((await call("addons.list", { installationId: second.id })).unverified).toBe(true);
    fs.clear();
    await auth.signOut();
    const unavailable = (await call("addons.list")).addons;
    expect(unavailable).toHaveLength(2);
    expect(unavailable.every((a: any) => a.sourceOff)).toBe(true);
    await call("addons.remove", { addonId: installed.addon.id });
    expect(
      existsSync(
        join(
          installation.location,
          "Interface/AddOns/TradeSkillMaster_AppHelper/TradeSkillMaster_AppHelper.toc",
        ),
      ),
    ).toBe(true);
    const remaining = (await call("addons.list")).addons;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].neededBy).toEqual([]);
    expect(provider.catalogSearch).toBe(false);
    expect(provider.discovers).toBe(false);
    expect(provider.getCategories).toBeUndefined();
  } finally {
    await auth.signOut();
    await mock.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

import {auctionDataFile} from '../backend/src/wow/tsm/AuctionDataFile';
import {discoverCharacters} from '../backend/src/wow/tsm/CharacterDiscovery';
import { zipSync } from "../backend/node_modules/fflate";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { AddonService } from "../backend/src/wow/addons/AddonService";
import { AddonInstaller } from "../backend/src/wow/addons/AddonInstaller";
import { needsUpdate } from "../backend/src/wow/addons/addonStatus";
import { recordFolders } from "../backend/src/wow/addons/AddonRecords";
import { WARNING_FOLDERS_MISSING, missingDependencies, toWireAddon } from "../backend/src/wow/addons/wire";
import { CompanionSyncCoordinator } from "../backend/src/wow/notifications/CompanionSync";
import { UpdateCheck } from "../backend/src/wow/notifications/UpdateCheck";

/** The check every installation goes through (UpdateCheck), as main.ts runs it. */
const checkAll = (service: AddonService, options?: { autoUpdate?: boolean }) =>
  new UpdateCheck(service, new CompanionSyncCoordinator(service)).checkAll(options);
import { AddonProvider } from "../backend/src/wow/providers/addon-provider";
import { ProviderRegistry } from "../backend/src/wow/providers/provider-registry";
import { createStateStore } from "../backend/src/wow/storage/StateStore";
import { FaultInjectingFs, type StageFs } from "../backend/src/wow/fs/StageFs";
import { NetworkClient } from "../backend/src/wow/net/network";
import { DownloadService } from "../backend/src/wow/downloads/DownloadService";
import type { AddonSearchResult, WowAddon, WowInstallation } from "../backend/src/wow/models";
import type { Toc } from "../backend/src/wow/toc/toc";
import { AddonChannelType, AddonDependencyType, WowClientType, type AddonProviderType } from "../backend/src/wow/types";
import type { OperationResult } from "../backend/src/api/contracts";

const roots: string[] = [];

/** A fresh directory for one test's store and game folder; removed after the test. */
function tempRoot(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `wowdeck-service-${name}-`));
  roots.push(root);
  return root;
}

interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  releaseId: string;
  folders: string[];
  requiredDependencyIds?: string[];
  /** Folder names the archive's TOCs list under `## OptionalDeps`. */
  optionalDeps?: string[];
  /** The provider lists no folders for its files (WoWInterface); the archive still holds `folders`. */
  unlisted?: boolean;
  /** Pre-release files besides the stable one (release channels, WF-03). */
  prereleases?: Array<{ channelType: AddonChannelType; version: string; releaseId: string; releaseDate: string }>;
}

/** The stable file's date; prerelease fixtures date themselves around it. */
const STABLE_DATE = "2026-06-01T00:00:00.000Z";

class FakeProvider extends AddonProvider {
  name: AddonProviderType = "WowUpHub";
  enabled = true;
  failGetById = false;
  override allowReinstall = true;
  override allowChannelChange = true;
  /** Errors getAll() reports alongside its results (a partial failure). */
  getAllErrors: Error[] = [];

  constructor(public catalog: CatalogEntry[]) {
    super();
  }

  override async getById(addonId: string): Promise<AddonSearchResult | undefined> {
    if (this.failGetById) {
      throw new Error("provider down");
    }
    const entry = this.catalog.find((c) => c.id === addonId);
    return entry ? this.toResult(entry) : undefined;
  }

  override async getAll(_installation: WowInstallation, addonIds: string[]): Promise<{ searchResults: AddonSearchResult[]; errors: Error[] }> {
    return {
      searchResults: this.catalog.filter((c) => addonIds.includes(c.id)).map((c) => this.toResult(c)),
      errors: this.getAllErrors,
    };
  }

  override async searchByQuery(query: string): Promise<AddonSearchResult[]> {
    return this.catalog.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).map((c) => this.toResult(c));
  }

  override isValidAddonId(addonId: string): boolean {
    return /^\d+$/.test(addonId);
  }

  private toResult(entry: CatalogEntry): AddonSearchResult {
    return {
      author: "Dev",
      externalId: entry.id,
      externalUrl: `https://fake/${entry.id}`,
      name: entry.name,
      providerName: this.name,
      downloadCount: 100,
      files: [
        {
          channelType: 0,
          folders: entry.unlisted ? [] : entry.folders,
          gameVersion: "11.0.2",
          downloadUrl: `https://fake/dl/${entry.id}.zip`,
          version: entry.version,
          releaseDate: STABLE_DATE,
          externalId: entry.releaseId,
          dependencies: (entry.requiredDependencyIds ?? []).map((externalAddonId) => ({
            externalAddonId,
            type: AddonDependencyType.Required,
          })),
        },
        ...(entry.prereleases ?? []).map((p) => ({
          channelType: p.channelType,
          folders: entry.folders,
          gameVersion: "11.0.2",
          downloadUrl: `https://fake/dl/${entry.id}.zip?v=${p.version}`,
          version: p.version,
          releaseDate: p.releaseDate,
          externalId: p.releaseId,
        })),
      ],
    };
  }
}

function zipFor(entry: CatalogEntry, version: string): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const folder of entry.folders) {
    files[`${folder}/${folder}.toc`] = new TextEncoder().encode(
      `## Title: ${entry.name}\n## Version: ${version}\n## Interface: 110005\n` +
        (entry.optionalDeps ? `## OptionalDeps: ${entry.optionalDeps.join(", ")}\n` : ""),
    );
  }
  return zipSync(files);
}

function makeNetwork(catalog: CatalogEntry[], versions: Record<string, string>): NetworkClient {
  return {
    downloadToFile: async (url: string, dest: string) => {
      const [, id, fileVersion] = url.match(/dl\/(\d+)\.zip(?:\?v=(.+))?/)!;
      const entry = catalog.find((c) => c.id === id!)!;
      const bytes = zipFor(entry, fileVersion ?? versions[id!] ?? entry.version);
      writeFileSync(dest, Buffer.from(bytes));
      return bytes.length;
    },
  } as unknown as NetworkClient;
}


async function listed(f: { service: AddonService; installation: WowInstallation }, id: string) {
  return (await f.service.listAddons(f.installation)).find((a) => a.id === id)!;
}

/** The stored record behind an addon, for what the wire form does not show. */
function stored(f: { service: AddonService; installation: WowInstallation }, id: string) {
  return f.service.addonsFor(f.installation.id).find((a) => a.id === id)!;
}

/** A service with its own provider, store and AddOns folder, for tests that must not share state. */
function localFixture(name: string, catalog: CatalogEntry[], fs?: StageFs) {
  const localProvider = new FakeProvider(catalog);
  const localVersions: Record<string, string> = Object.fromEntries(catalog.map((c) => [c.id, c.version]));
  const registry = new ProviderRegistry();
  registry.register(localProvider);
  const localRoot = tempRoot(name);
  const installRoot = join(localRoot, "_retail_");
  const addonsPath = join(installRoot, "Interface", "AddOns");
  mkdirSync(addonsPath, { recursive: true });
  const localInstallation: WowInstallation = {
    id: `inst-${name}`,
    clientType: WowClientType.Retail,
    location: installRoot,
    label: "_retail_",
    displayName: "Retail",
    selected: false,
    defaultAddonChannelType: 0,
    source: "detected",
  };
  const store = createStateStore(localRoot, fs);
  store.setInstallations([localInstallation]);
  const operations: OperationResult[] = [];
  const changed: string[][] = [];
  // Each download's URL, in order: a test waits on it to act while an install runs.
  const downloads: string[] = [];
  const network = makeNetwork(localProvider.catalog, localVersions);
  const downloadToFile = network.downloadToFile.bind(network);
  network.downloadToFile = (url, ...rest) => {
    downloads.push(url);
    return downloadToFile(url, ...rest);
  };
  const localService = new AddonService(
    store,
    registry,
    new DownloadService(network, join(localRoot, "dl")),
    {
      addonsChanged: (ids) => changed.push(ids),
      operationResult: (op) => operations.push(op),
    },
  );
  return {
    service: localService,
    provider: localProvider,
    versions: localVersions,
    store,
    installation: localInstallation,
    addonsPath,
    operations,
    changed,
    downloads,
  };
}


import assert from 'node:assert/strict';
const pass=(name:string)=>console.log(JSON.stringify({method:'DEVICE isolated engine fixture',name,result:'passed'}));
const originalNow=Date.now; Date.now=()=>1800000000000;
try {
const f=localFixture('third', [{id:'990',name:'Recent',version:'1.0',releaseId:'r1',folders:['Recent'],prereleases:[{channelType:AddonChannelType.Beta,version:'4.0-beta',releaseId:'b4',releaseDate:'2026-07-01T00:00:00.000Z'}]}]);
const {addon}=await f.service.install({intent:'install',providerId:'WowUpHub',externalId:'990',installation:f.installation});
const release=(v:string,r:string)=>{Object.assign(f.provider.catalog[0],{version:v,releaseId:r});f.versions['990']=v};
release('2.0','r2'); await f.service.updateAddon(addon.id); assert.equal((await listed(f,addon.id)).newlyUpdated,true); pass('successful acquisition marks Updated');
release('3.0','r3');await f.service.refresh(f.installation);assert.equal((await listed(f,addon.id)).newlyUpdated,false);
const reg=new ProviderRegistry();reg.register(f.provider);const restarted=new AddonService(createStateStore(dirname(f.installation.location)),reg,new DownloadService(makeNetwork(f.provider.catalog,f.versions),join(dirname(f.installation.location),'restart-dl')),{addonsChanged:()=>{},operationResult:()=>{}});assert.equal((await restarted.listAddons(f.installation))[0].newlyUpdated,false);pass('provider offer invalidates Updated across persistence restart');
renameSync(f.installation.location,f.installation.location+'.away');const failed=await f.service.updateAddon(addon.id);renameSync(f.installation.location+'.away',f.installation.location);assert.equal(failed.operation.status,'failed');assert.equal(failed.addon.newlyUpdated,false);pass('failed acquisition leaves Updated clear');
release('2.0','r2');await f.service.refresh(f.installation);assert.equal((await listed(f,addon.id)).newlyUpdated,false);pass('withdrawn offer does not restore Updated');
await f.service.setChannel(addon.id,AddonChannelType.Beta);assert.equal((await listed(f,addon.id)).newlyUpdated,false);await f.service.setChannel(addon.id,AddonChannelType.Stable);pass('channel changes leave Updated clear');
release('3.0','r3');await f.service.refresh(f.installation);f.store.updateSettings({autoUpdate:false});assert.equal(await f.service.autoUpdate(async()=>'not_running'),null);f.store.updateSettings({autoUpdate:true});
for(const prefs of [{hidden:true,autoUpdateEnabled:true},{hidden:false,autoUpdateEnabled:false}]){f.service.installations.update(f.installation.id,prefs);assert.equal(await f.service.autoUpdate(async()=>'not_running'),null)}
f.service.installations.update(f.installation.id,{hidden:false,autoUpdateEnabled:true});assert.equal((await f.service.autoUpdate(async()=>'running'))?.skipped,'WoW was running');assert.equal((await listed(f,addon.id)).version,'2.0');pass('scheduler global off, hidden, per-installation off, game running skip matrix');
await f.service.autoUpdate(async()=>'not_running');assert.equal((await listed(f,addon.id)).version,'3.0');pass('scheduler eligible acquisition');release('4.0','r4');await f.service.refresh(f.installation);f.service.installations.update(f.installation.id,{hidden:true,autoUpdateEnabled:false});await f.service.updateAll(f.installation);assert.equal((await listed(f,addon.id)).version,'4.0');pass('manual update-all acquires while hidden and auto off');
const d=localFixture('dependency',[{id:'1',name:'Parent',version:'1',releaseId:'p1',folders:['Parent'],requiredDependencyIds:['2']},{id:'2',name:'Library',version:'1',releaseId:'l1',folders:['Library']}]);const p=await d.service.install({intent:'install',providerId:'WowUpHub',externalId:'1',installation:d.installation});const lib=(await d.service.listAddons(d.installation)).find(a=>a.folderName==='Library')!;assert.equal(lib.installedAsDependency,true);assert.ok(lib.neededBy.length);await d.service.removeAddon(p.addon.id);assert.equal((await listed(d,lib.id)).neededBy.length,0);pass('real isolated dependency archive mutation and parent removal');

const root=tempRoot('local-data');const retail={...f.installation,location:join(root,'_retail_')};mkdirSync(join(retail.location,'WTF/Account/FIXTURE/Realm/Hero'),{recursive:true});writeFileSync(join(retail.location,'WTF/Config.wtf'),'SET portal "EU"');assert.deepEqual(discoverCharacters([retail]).map(c=>[c.name,c.region,c.faction]),[['Realm','eu','ALL']]);pass('local character discovery from isolated WTF files');
const file=join(root,'AppData.lua');const line=(k:string)=>`select(2, ...).LoadData("AUCTIONDB_NON_COMMODITY_DATA","${k}",[[return {x=1}]]) --<AUCTIONDB_NON_COMMODITY_DATA,${k},100,7>\n`;writeFileSync(file,'-- unknown preserved\n'+line('Realm-Alliance')+line('Other-Horde'));assert.deepEqual(auctionDataFile.apply(file,new Set(['Realm-Alliance']),[{tag:'AUCTIONDB_NON_COMMODITY_DATA',keys:['Realm-Alliance'],time:200,ah:7,data:'{x=2}'}]),{ok:true});assert.ok(readFileSync(file,'utf8').includes('-- unknown preserved'));assert.equal(auctionDataFile.read(file).latest('Other-Horde'),null);assert.equal(auctionDataFile.read(file).latest('Realm-Alliance'),200);pass('auction file pruning, unknown preservation, replacement');

const classic={...retail,id:'classic',clientType:2,location:join(root,'_classic_era_')};const sv=join(classic.location,'WTF/Account/FIXTURE/SavedVariables');mkdirSync(sv,{recursive:true});writeFileSync(join(sv,'TradeSkillMaster_AppHelper.lua'),'TradeSkillMaster_AppHelperDB = {region="Classic-EU"}');writeFileSync(join(sv,'TradeSkillMaster.lua'),'TradeSkillMasterDB = {_scopeKeys={factionrealm={"Horde - Realm"}}}');assert.deepEqual(discoverCharacters([retail,classic]).filter(c=>!c.retail).map(c=>[c.name,c.region,c.faction]),[['Realm','eu','HORDE']]);pass('cross-flavor local character faction discovery');
const before=readFileSync(file,'utf8');mkdirSync(file+'.wowdeck-tmp');assert.equal(auctionDataFile.apply(file,new Set(),[]).ok,false);assert.equal(readFileSync(file,'utf8'),before);pass('auction staging write failure preserves previous file');
const t=localFixture('protected-tsm',[]);for(const [name,git] of [['TradeSkillMaster',true],['TradeSkillMaster_AppHelper',false]] as const){const path=join(t.addonsPath,name);mkdirSync(path,{recursive:true});writeFileSync(join(path,name+'.toc'),'## Interface: 110005\n## Version: @project-version@\n');if(git)mkdirSync(join(path,'.git'));}const protectedResult=await t.service.removeTradeSkillMasterAddons(t.installation);assert.ok(protectedResult.operations.every(op=>op.status==='failed'));assert.ok(existsSync(join(t.addonsPath,'TradeSkillMaster')));assert.ok(existsSync(join(t.addonsPath,'TradeSkillMaster_AppHelper')));pass('TSM protected developer-copy removal keeps isolated files');
} finally {Date.now=originalNow;for(const root of roots)rmSync(root,{recursive:true,force:true})}

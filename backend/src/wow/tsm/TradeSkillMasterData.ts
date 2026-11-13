/**
 * Format/protocol adapted from tsm-app-linux (MIT), tsm/wow/lua_writer.py
 * and tsm/core/services/auction.py, plus account API in docs/api.md, commit 1908e34930f742a3a9ce754faf4e1839431fff3a.
 * See docs/tsm-provenance.md and THIRD_PARTY_NOTICES.md.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "fflate";
import type { TradeSkillMasterDestination } from "../../api/contracts";
import type { StateStore } from "../storage/StateStore";
import type { TradeSkillMasterAuth } from "./TradeSkillMasterAuth";
import type { TradeSkillMasterProvider } from "./TradeSkillMasterProvider";
import { tradeSkillMasterFolders } from "./TradeSkillMasterFolders";
import { appInfoEntry, auctionDataFile, auctionDataTags, covers, type AuctionDataFile, type AuctionEntry } from "./AuctionDataFile";

import { discoverCharacters, matchesFlavor, regionKey, realmKey, realmFolders } from "./CharacterDiscovery";

interface Region {
  regionId: number;
  gameVersion: string;
  regionPrefix: string;
}
interface Realm {
  realmId: number;
  localizedName: string;
  regionId: number;
  region: Region;
  auctionHouses: { type: string; auctionHouseId: number }[];
}
export interface TsmCandidate {
  realmId: number;
  auctionHouseType: string;
}
interface Follow extends TsmCandidate {
  id?: string;
  realmId: number;
  auctionHouseType: string;
}
interface Cache {
  tier?: "free" | "gold" | "platinum";
  realms: Realm[];
  regions: Region[];
  gameVersions: unknown[];
  follows: Follow[];
}
class FollowRefused extends Error {}

export class TradeSkillMasterData {
  #cache: Cache = { realms: [], regions: [], gameVersions: [], follows: [] };
  #seen = new Set<string>();
  #scanTimer?: unknown;
  #mutations: Promise<unknown> = Promise.resolve();
  #choices: Record<string, { declined: boolean; owned: boolean; account?: string }> = {};
  #pending = new Map<string, AuctionEntry[]>();
  #timer?: unknown;
  #periodic?: unknown;
  #appInfo: Record<string, any> = {};
  #generation = 0;
  #token: string | null = null;
  #active = 0;
  #slots: (() => void)[] = [];
  #jobs = new Set<Promise<void>>();
  #forced = new Map<string, Set<string>>();
  #transferEpoch = 0;
  #abort = new AbortController();
  #lastPush: number | null = null;
  ready = Promise.resolve();
  constructor(
    private auth: TradeSkillMasterAuth,
    private provider: TradeSkillMasterProvider,
    private store: StateStore,
    private dir: string,
    public changed: () => void,
    private candidates: (installationId: string) => TsmCandidate[] = () => [],
    private files: AuctionDataFile = auctionDataFile,
  ) {
    try {
      this.#cache = JSON.parse(readFileSync(join(dir, "tsm-catalogue.json"), "utf8"));
    } catch {
      /* First run. */
    }
    try {
      this.#choices = JSON.parse(readFileSync(join(dir, "tsm-choices.json"), "utf8"));
    } catch { /* First run. */ }
    auth.sessionListeners.add((token) => {
      this.#abort.abort();
      this.#abort = new AbortController();
      this.#pending.clear();
      this.#forced.clear();
      auth.sessionClock.clearTimeout(this.#timer);
      this.#timer = undefined;
      this.#token = token;
      const generation = ++this.#generation;
      auth.sessionClock.clearTimeout(this.#periodic);
      auth.sessionClock.clearTimeout(this.#scanTimer);
      this.#seen.clear();
      if (token) this.ready = this.load(token, generation).then(() => this.autoFollow(generation));
    });
    provider.dataListeners.add((name, payload) => {
      const generation = this.#generation;
      const epoch = this.#transferEpoch;
      const job = (async () => {
        await this.ready;
        if (this.#active >= 4) await new Promise<void>((resolve) => this.#slots.push(resolve));
        else this.#active++;
        try {
          if (generation !== this.#generation || epoch !== this.#transferEpoch || !this.#token || !provider.enabled) return;
          this.#lastPush = this.auth.sessionClock.now?.() ?? Date.now();
          await this.event(name, payload);
        } finally {
          const next = this.#slots.shift();
          if (next) next(); else this.#active--;
        }
      })().catch(() => { /* Never expose remote payloads or URLs. */ });
      this.#jobs.add(job);
      void job.finally(() => this.#jobs.delete(job));
    });
  }
  diagnostics(): import("../../api/contracts").TradeSkillMasterDiagnostics {
    return { enabled: this.provider.enabled, signedIn: this.auth.signedIn,
      tier: this.auth.status().tier ?? null, connected: this.provider.connected,
      lastPush: this.#lastPush, followedCount: this.#cache.follows.length };
  }
  refresh(installationId: string): void {
    if (!this.provider.enabled || !this.#token) return;
    this.#transferEpoch++;
    this.#abort.abort();
    this.#abort = new AbortController();
    const installation = this.store.installations.find((i) => i.id === installationId);
    for (const path of this.paths().filter((p) => installation && p.startsWith(installation.location + "/"))) {
      this.#pending.delete(path);
      this.#forced.set(path, new Set());
    }
    this.provider.reconnect();
  }
  /** A committed change to an installation's addon folders: one of ours moves or replaces a data file. */
  foldersChanged(installationId: string, folders: string[]): void {
    if (folders.some((folder) => tradeSkillMasterFolders.includes(folder))) this.refresh(installationId);
  }
  wake(): void { if (this.provider.enabled && this.#token) this.provider.reconnect(); }
  private choiceKey(f: TsmCandidate): string {
    return JSON.stringify([f.realmId, f.auctionHouseType]);
  }
  async account(): Promise<import("../../api/contracts").TradeSkillMasterAccount> {
    await this.ready;
    if (!this.#token || !this.provider.enabled) throw new Error("Sign in to TradeSkillMaster");
    await this.load(this.#token, this.#generation, true, false);
    return this.accountSnapshot();
  }
  private accountSnapshot(): import("../../api/contracts").TradeSkillMasterAccount {
    const status = this.auth.status();
    const tier = status.tier ?? this.#cache.tier ?? "free";
    return {
      account: status.account,
      followedCount: this.#cache.follows.length,
      allowance: tier === "platinum" ? null : tier === "gold" ? 25 : 10,
      follows: this.#cache.follows.map((f) => {
        const realm = this.#cache.realms.find((r) => r.realmId === f.realmId);
        return { realmId: f.realmId, auctionHouseType: f.auctionHouseType,
          name: realm?.localizedName ?? `Realm ${f.realmId}`,
          region: realm?.region.regionPrefix.toUpperCase() ?? "Unknown region",
          gameVersion: realm?.region.gameVersion ?? "Unknown WoW version" };
      }),
    };
  }
  private accountId(): string {
    return JSON.parse(Buffer.from(this.#token!.split(".")[1]!, "base64url").toString()).sub;
  }
  async cleanupPreview(installationId: string) {
    const account = await this.account();
    const local = new Set(this.discovered(installationId).map((f) => this.choiceKey(f)));
    const others = new Set(this.store.installations.filter((i) => i.id !== installationId)
      .flatMap((i) => this.discovered(i.id)).map((f) => this.choiceKey(f)));
    return account.follows.filter((f) => {
      const key = this.choiceKey(f);
      const provenance = this.#choices[key];
      return provenance?.owned && provenance.account === this.accountId() && local.has(key) && !others.has(key);
    });
  }
  async cleanupFollows(installationId: string, preview?: import("../../api/contracts").TradeSkillMasterAccount["follows"]) {
    const removed: import("../../api/contracts").TradeSkillMasterAccount["follows"] = [];
    const leftBehind: typeof removed = [];
    let eligible: typeof removed;
    try { eligible = await this.cleanupPreview(installationId); }
    catch { return { removed, leftBehind: preview ?? [], error: "Could not check account follows. Account cleanup was not completed." }; }
    // The preview records consent and identities only; fresh eligibility authorizes deletion.
    const selected = preview ?? eligible;
    for (const follow of selected) {
      try {
        const result = this.#mutations.then(async () => {
          // Recheck against current account and installations before each mutation.
          const current = await this.cleanupPreview(installationId);
          if (!current.some((f) => this.choiceKey(f) === this.choiceKey(follow)))
            throw new Error("Follow eligibility changed");
          await this.mutateFollow(follow.realmId, follow.auctionHouseType, false);
        });
        this.#mutations = result.catch(() => {});
        await result;
        removed.push(follow);
      } catch { leftBehind.push(follow); }
    }
    return { removed, leftBehind };
  }
  async unfollow(realmId: number, auctionHouseType: string) {
    await this.ready;
    const result = this.#mutations.then(() => this.mutateFollow(realmId, auctionHouseType, false));
    this.#mutations = result.catch(() => {});
    await result;
    return this.accountSnapshot();
  }
  async setFollow(installationId: string, realmId: number, auctionHouseType: string, followed: boolean): Promise<TradeSkillMasterDestination> {
    await this.ready;
    const result = this.#mutations.then(() => this.mutateFollow(realmId, auctionHouseType, followed));
    this.#mutations = result.catch(() => {});
    await result;
    return this.destination(installationId);
  }
  private async mutateFollow(realmId: number, auctionHouseType: string, followed: boolean): Promise<void> {
    const token = this.#token;
    const generation = this.#generation;
    const endpoint = this.auth.apiEndpoints.userRealms;
    if (!this.provider.enabled || !token || !endpoint) throw new Error("Sign in to TradeSkillMaster");
    await this.load(token, generation, true);
    if (generation !== this.#generation || !this.provider.enabled) throw new Error("TradeSkillMaster session changed; reload the account list");
    const realm = this.#cache.realms.find((r) => r.realmId === realmId);
    if (!realm || !realm.auctionHouses.some((a) => a.type.toUpperCase() === auctionHouseType))
      throw new Error("Unknown auction house");
    const follow = this.#cache.follows.find((f) => f.realmId === realmId && f.auctionHouseType === auctionHouseType);
    const key = this.choiceKey({ realmId, auctionHouseType });
    if (followed !== !!follow) {
      if (!followed && !follow?.id) throw new Error("Reload the account list before unfollowing");
      const userId = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).sub;
      const response = await fetch(followed ? endpoint : endpoint + "/" + encodeURIComponent(follow!.id!), {
        method: followed ? "POST" : "DELETE",
        // DELETE has no body; with a JSON content type the server answers 400.
        headers: { Authorization: "Bearer " + token, "User-Agent": this.auth.userAgent, ...(followed ? { "Content-Type": "application/json" } : {}) },
        body: followed ? JSON.stringify({ realmId, auctionHouseType, userId }) : undefined,
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new FollowRefused(followed ? "TradeSkillMaster refused the follow request. Your account may have reached its realm limit." : "TradeSkillMaster could not unfollow this realm");
      if (generation !== this.#generation) throw new Error("TradeSkillMaster session changed; reload the account list");
      this.#choices[key] = { declined: !followed, owned: followed, account: this.accountId() };
    } else if (followed) {
      this.#choices[key] = { declined: false, owned: this.#choices[key]?.owned ?? false, account: this.#choices[key]?.account };
    }
    const path = join(this.dir, "tsm-choices.json");
    writeFileSync(path + ".tmp", JSON.stringify(this.#choices), { mode: 0o600 });
    renameSync(path + ".tmp", path);
    if (!followed) {
      this.#cache.follows = this.#cache.follows.filter((f) => this.choiceKey(f) !== key);
      this.changed();
    } else {
      await this.load(token, this.#generation, true);
    }
    this.provider.reconnect();
  }
  private discovered(installationId?: string): TsmCandidate[] {
    return discoverCharacters(this.store.installations).flatMap((c) => {
      if (installationId && c.installationId !== installationId) return [];
      const installation = this.store.installations.find((i) => i.id === c.installationId)!;
      return this.#cache.realms.filter((r) => matchesFlavor(installation, r.region.gameVersion) &&
        r.region.regionPrefix.toLowerCase() === c.region && r.localizedName === c.name &&
        r.auctionHouses.some((a) => a.type.toUpperCase() === c.faction))
        .map((r) => ({ realmId: r.realmId, auctionHouseType: c.faction }));
    });
  }
  private async autoFollow(generation: number): Promise<void> {
    try {
      if (generation !== this.#generation || !this.#token || !this.provider.enabled) return;
      const discovered = this.discovered();
      const fresh = discovered.filter((c) => !this.#seen.has(this.choiceKey(c)));
      for (const c of discovered) this.#seen.add(this.choiceKey(c));
      for (const candidate of fresh.length ? discovered : []) {
        if (generation !== this.#generation || !this.#token || !this.provider.enabled) break;
        const key = this.choiceKey(candidate);
        if (this.#choices[key]?.declined || this.#cache.follows.some((f) => this.choiceKey(f) === key)) continue;
        // Share the manual mutation queue, without awaiting ready from inside it.
        const result = this.#mutations.then(() => {
          if (generation !== this.#generation || !this.provider.enabled) return;
          return this.mutateFollow(candidate.realmId, candidate.auctionHouseType, true);
        });
        this.#mutations = result.catch(() => {});
        try { await result; } catch (error) {
          // A network failure must not consume discovery; retry on the next scan.
          if (!(error instanceof FollowRefused)) this.#seen.clear();
          break;
        }
      }
    } finally {
      if (generation === this.#generation && this.#token) {
        this.auth.sessionClock.clearTimeout(this.#scanTimer);
        this.#scanTimer = this.auth.sessionClock.setTimeout(() => this.autoFollow(generation), 30000);
      }
    }
  }
  private paths(): string[] {
    return this.store.installations
      .filter((i) => Object.keys(realmFolders).some((v) => matchesFlavor(i, v)))
      .flatMap((i) => {
        const root = join(i.location, "Interface/AddOns");
        if (
          !["TradeSkillMaster_AppHelper", "TradeSkillMaster"].some((n) => existsSync(join(root, n)))
        )
          return [];
        return [
          join(
            root,
            existsSync(join(root, "TradeSkillMaster_AppHelper"))
              ? "TradeSkillMaster_AppHelper"
              : "TradeSkillMaster",
            "AppData.lua",
          ),
        ];
      });
  }
  private async load(token: string, generation: number, required = false, notify = true): Promise<void> {
    const endpoints = this.auth.apiEndpoints;
    if (!endpoints.realms || !endpoints.regions || !endpoints.gameVersions || !endpoints.userRealms)
      return;
    try {
      const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
      const followsUrl = new URL(endpoints.userRealms);
      followsUrl.searchParams.set("userIds", claims.sub ?? "");
      const values = await Promise.all(
        [endpoints.realms, endpoints.regions, endpoints.gameVersions, followsUrl.href].map(
          async (url) => {
            const r = await fetch(url, {
              headers: { Authorization: "Bearer " + token, "User-Agent": this.auth.userAgent },
              signal: AbortSignal.timeout(15000),
            });
            if (!r.ok) throw new Error("Catalogue unavailable");
            const result = await r.json() as any;
            if (url === followsUrl.href) {
              for (let page = 2; page <= (result.metadata?.totalPages ?? 1); page++) {
                const next = new URL(url);
                next.searchParams.set("page", String(page));
                const response = await fetch(next, {
                  headers: { Authorization: "Bearer " + token, "User-Agent": this.auth.userAgent },
                  signal: AbortSignal.timeout(15000),
                });
                if (!response.ok) throw new Error("Account list unavailable");
                result.items.push(...(await response.json() as any).items);
              }
            }
            return result;
          },
        ),
      );
      if (generation !== this.#generation) return;
      if (
        !Array.isArray(values[0].items) ||
        !Array.isArray(values[1].items) ||
        !Array.isArray(values[2]) ||
        !Array.isArray(values[3].items)
      )
        throw new Error("Invalid catalogue");
      this.#cache = {
        tier: this.auth.status().tier,
        realms: values[0].items,
        regions: values[1].items,
        gameVersions: values[2],
        follows: values[3].items,
      };
      this.#cache.regions = this.#cache.regions.filter(
        (r) =>
          Number.isSafeInteger(r.regionId) &&
          typeof r.gameVersion === "string" &&
          /^[a-z]+$/i.test(r.regionPrefix),
      );
      this.#cache.realms = this.#cache.realms
        .filter(
          (r) =>
            Number.isSafeInteger(r.realmId) &&
            typeof r.localizedName === "string" &&
            !/[|,<>\r\n]/.test(r.localizedName) &&
            Array.isArray(r.auctionHouses),
        )
        .map((r) => ({
          ...r,
          region: r.region ?? this.#cache.regions.find((region) => region.regionId === r.regionId)!,
        }))
        .filter((r) => !!r.region);
      this.#cache.follows = this.#cache.follows.filter(
        (f) => Number.isSafeInteger(f.realmId) && typeof f.auctionHouseType === "string",
      );
      const path = join(this.dir, "tsm-catalogue.json");
      writeFileSync(path + ".tmp", JSON.stringify(this.#cache), { mode: 0o600 });
      renameSync(path + ".tmp", path);
      for (const path of this.paths()) if (!this.#pending.has(path)) this.#pending.set(path, []);
      this.appInfo(this.#appInfo);
      this.schedule();
      if (notify) this.changed();
    } catch {
      if (required) throw new Error("Could not reload TradeSkillMaster account follows");
      /* Use cached catalogue offline. */
    }
    if (generation === this.#generation) {
      this.auth.sessionClock.clearTimeout(this.#periodic);
      this.periodic(generation);
    }
  }
  private periodic(generation: number): void {
    this.#periodic = this.auth.sessionClock.setTimeout(() => {
      if (generation !== this.#generation || !this.#token) return;
      this.appInfo(this.#appInfo);
      this.periodic(generation);
    }, 900000);
  }
  private followed(): Realm[] {
    return this.#cache.realms.filter(
      (r) =>
        this.#cache.follows.some((f) => f.realmId === r.realmId),
    );
  }
  private schedule(): void {
    if (this.#timer !== undefined) return;
    this.#timer = this.auth.sessionClock.setTimeout(() => {
      this.#timer = undefined;
      this.flush();
    }, 1500);
  }
  private flush(): void {
    // A path that is no longer a target (AppHelper removed, installation
    // gone) is dropped rather than retried; a refresh fills the new one.
    const targets = new Set(this.paths());
    for (const path of [...this.#pending.keys()]) if (!targets.has(path)) this.#pending.delete(path);
    for (const path of [...this.#forced.keys()]) if (!targets.has(path)) this.#forced.delete(path);
    const allowed = new Set(this.#cache.follows.flatMap((f) => {
      const r = this.#cache.realms.find((r) => r.realmId === f.realmId);
      return r ? [realmKey(r.localizedName, f.auctionHouseType)] : [];
    }));
    for (const [path, pending] of [...this.#pending]) {
      // A failed path keeps its pending writes; the previous file stays intact.
      if (this.files.apply(path, allowed, pending).ok) this.#pending.delete(path);
    }
    this.changed();
  }
  private appInfo(payload: Record<string, any>): void {
    const entry = appInfoEntry(payload, Math.floor((this.auth.sessionClock.now?.() ?? Date.now()) / 1000));
    for (const path of this.paths())
      this.#pending.set(path, [
        ...(this.#pending.get(path) ?? []),
        entry,
      ]);
    this.schedule();
  }
  private async event(name: string, value: unknown): Promise<void> {
    if (!value || typeof value !== "object") return;
    const p = value as Record<string, any>;
    if (name === "app_info") {
      this.#appInfo = p;
      this.appInfo(p);
      return;
    }
    if (!["realm_auctiondb", "realm_shopping", "region_auctiondb"].includes(name)) return;
    // Why a push wrote nothing; ids and types only, never the signed URL.
    const what = `${name} ${p.realmId ?? p.regionId}${p.auctionHouseType ? "/" + String(p.auctionHouseType) : ""} ${String(p.stringType)}`;
    const skip = (reason: string) => console.error(`[tsm] ${what}: ${reason}`);
    const region =
      name === "region_auctiondb"
        ? this.#cache.regions.find((r) => r.regionId === p.regionId && regionKey(r.gameVersion, r.regionPrefix) !== undefined)
        : undefined;
    const realm =
      name !== "region_auctiondb"
        ? this.followed().find((r) => r.realmId === p.realmId && this.#cache.follows.some((f) => f.realmId === r.realmId && f.auctionHouseType === p.auctionHouseType))
        : undefined;
    if (!region && !realm) return skip(name === "region_auctiondb" ? "unknown region" : "not a followed auction house");
    p.lastModified = Number(p.lastModified);
    if (
      !auctionDataTags.has(p.stringType) ||
      p.stringType === "APP_INFO" ||
      !Number.isSafeInteger(p.lastModified) ||
      p.lastModified <= 0 ||
      typeof p.url !== "string"
    )
      return skip("unusable payload");
    const ah = realm?.auctionHouses.find((a) => a.type.toUpperCase() === p.auctionHouseType)?.auctionHouseId;
    const keys = realm
      ? this.followed()
          .filter(
            (r) =>
              this.#cache.follows.some((f) => f.realmId === r.realmId && f.auctionHouseType === p.auctionHouseType) && (r.realmId === realm.realmId ||
              (ah !== undefined &&
                r.regionId === realm.regionId &&
                r.auctionHouses.some((a) => a.type.toUpperCase() === p.auctionHouseType && a.auctionHouseId === ah))),
          )
          .map((r) => realmKey(r.localizedName, p.auctionHouseType))
      : [regionKey(region!.gameVersion, region!.regionPrefix)!];
    const identity = JSON.stringify([name, p.stringType, keys]);
    const forced = (path: string) => this.#forced.has(path) && !this.#forced.get(path)!.has(identity);
    const version = (realm?.region ?? region)!.gameVersion;
    const targets = this.paths().filter((path) => this.store.installations.some((i) => path.startsWith(i.location + "/") && matchesFlavor(i, version))).filter((path) => forced(path) ||
      keys.some(
        (key) =>
          !this.files.read(path).covers(p.stringType, key, p.lastModified) &&
          !covers(this.#pending.get(path) ?? [], p.stringType, key, p.lastModified),
      ),
    );
    if (!targets.length) {
      skip("no installation needs it");
      this.changed();
      return;
    }
    const generation = this.#generation;
    const epoch = this.#transferEpoch;
    let raw: Uint8Array | undefined;
    for (let attempt = 0; attempt < 3 && epoch === this.#transferEpoch && generation === this.#generation && this.provider.enabled; attempt++) {
      try {
        const r = await fetch(p.url, {
          headers: { "User-Agent": this.auth.userAgent },
          signal: AbortSignal.any([this.#abort.signal, AbortSignal.timeout(15000)]),
        });
        if (r.ok) {
          raw = new Uint8Array(await r.arrayBuffer());
          break;
        }
      } catch {
        /* Retry without logging the signed URL. */
      }
    }
    if (epoch !== this.#transferEpoch || generation !== this.#generation) return;
    if (!raw) return skip("download failed");
    // The blob is stored gzipped; with Content-Encoding: gzip fetch has already unpacked it.
    const data = new TextDecoder("utf-8", { fatal: true })
      .decode(raw[0] === 31 && raw[1] === 139 ? gunzipSync(raw) : raw)
      .trim()
      .replace(/^return\s+/, "");
    if (!data.startsWith("{") || data.includes("]]") || data.includes("\n") || data.includes("\r"))
      return skip("unsafe data string");
    for (const path of targets) {
      const force = forced(path);
      this.#forced.get(path)?.add(identity);
      this.#pending.set(path, [
        ...(this.#pending.get(path) ?? []),
        { tag: p.stringType, keys, time: p.lastModified, ah, data, forced: force },
      ]);
    }
    this.schedule();
    this.changed();
  }
  async destination(installationId: string): Promise<TradeSkillMasterDestination> {
    await this.ready;
    while (this.#jobs.size) await Promise.all(this.#jobs);
    const installation = this.store.installations.find((i) => i.id === installationId);
    const path =
      installation && this.paths().find((p) => p.startsWith(installation.location + "/"));
    const snapshot = path ? this.files.read(path) : undefined;
    // The scan time, as the official client's "last updated": historical
    // and sale data have their own, older schedules.
    const updated = (key: string, tag: string) => snapshot?.latest(key, tag) ?? null;
    const tier = this.auth.status().tier ?? this.#cache.tier ?? "free";
    const local = [...this.candidates(installationId), ...this.discovered(installationId)];
    const localRegions = new Set(local.map((c) => this.#cache.realms.find((r) => r.realmId === c.realmId)!.regionId));
    return {
      tier,
      followedCount: this.#cache.follows.length,
      allowance: tier === "platinum" ? null : tier === "gold" ? 25 : 10,
      realms: [...this.#cache.follows, ...local]
        .filter((f) => local.some((c) => this.choiceKey(c) === this.choiceKey(f)))
        .filter((f, index, all) => all.findIndex((other) => this.choiceKey(other) === this.choiceKey(f)) === index)
        .flatMap((f) => {
          const r = this.#cache.realms.find((r) => r.realmId === f.realmId);
          if (!r || !installation || !matchesFlavor(installation, r.region.gameVersion)) return [];
          const choice = this.#choices[this.choiceKey(f)];
          return [{
            id: r.realmId, name: r.localizedName, auctionHouseType: f.auctionHouseType,
            followed: this.#cache.follows.some((other) => this.choiceKey(other) === this.choiceKey(f)),
            owned: choice?.owned ?? false, declined: choice?.declined ?? false,
            updated: updated(realmKey(r.localizedName, f.auctionHouseType), "AUCTIONDB_NON_COMMODITY_DATA"),
          }];
        }),
      regions:
        installation
          ? this.#cache.regions
              .filter((r) => localRegions.has(r.regionId) && matchesFlavor(installation, r.gameVersion))
              .map((r) => ({
                id: r.regionId,
                name: regionKey(r.gameVersion, r.regionPrefix)!,
                updated: updated(regionKey(r.gameVersion, r.regionPrefix)!, "AUCTIONDB_REGION_STAT"),
              }))
          : [],
    };
  }
}

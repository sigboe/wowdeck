/**
 * Protocol adapted from tsm-app-linux (MIT), tsm/api/socket.py and docs/api.md.
 * Commit: 1908e34930f742a3a9ce754faf4e1839431fff3a.
 * Bun transport and normal addon metadata; see docs/tsm-provenance.md.
 */
import { AddonProvider, type ScanMatch, type GetAllResult } from "../providers/addon-provider";
import type { AddonFolder, AddonSearchResult, WowInstallation } from "../models";
import { AddonChannelType, AddonDependencyType } from "../types";
import type { Toc } from "../toc/toc";
import { basename, dirname } from "node:path";
import type { TradeSkillMasterAuth } from "./TradeSkillMasterAuth";
import { tradeSkillMasterFolders } from "./TradeSkillMasterFolders";

interface Release {
  addon: string;
  channel: string;
  version: string;
  url: string;
}
const names = tradeSkillMasterFolders;
export class TradeSkillMasterProvider extends AddonProvider {
  override allowReinstall = true;
  override allowChannelChange = true;
  readonly dataListeners = new Set<(name: string, payload: unknown) => void>();
  connected = false;
  reconnect = (): void => {};
  #socket?: WebSocket;
  #retry?: unknown;
  #idle?: unknown;
  #attempt = 0;
  #serverBackoff = false;
  #ready?: Promise<void>;
  #finish?: () => void;
  #waiting?: unknown;
  #releases: Release[] = [];
  constructor(private auth: TradeSkillMasterAuth) {
    super();
    this.name = "TradeSkillMaster";
    const connect = (token: string | null) => {
      auth.sessionClock.clearTimeout(this.#retry);
      auth.sessionClock.clearTimeout(this.#idle);
      this.connected = false;
      const old = this.#socket;
      this.#socket = undefined;
      old?.close();
      if (!token) {
        this.#releases = [];
        this.#finish?.();
      }
      if (token && auth.socketUrl && !this.#releases.length && !this.#ready) {
        this.#ready = new Promise<void>((resolve) => {
          this.#finish = () => {
            auth.sessionClock.clearTimeout(this.#waiting);
            this.#ready = undefined;
            resolve();
          };
          this.#waiting = auth.sessionClock.setTimeout(this.#finish, 15000);
        });
      }
      if (!token || !auth.socketUrl) return;
      const socket = new WebSocket(auth.socketUrl, {
        headers: { Authorization: token, "User-Agent": auth.userAgent },
      });
      this.#socket = socket;
      socket.onmessage = (event) => {
        if (this.#socket !== socket) return;
        const frame = String(event.data);
        auth.sessionClock.clearTimeout(this.#idle);
        this.#idle = auth.sessionClock.setTimeout(() => socket.close(), 45000);
        if (frame.startsWith("0")) socket.send("40");
        else if (frame.startsWith("40")) { this.#attempt = 0; this.#serverBackoff = false; this.connected = true; }
        else if (frame === "2") socket.send("3");
        else if (frame.startsWith("42")) {
          try {
            const [name, payload] = JSON.parse(frame.slice(2));
            for (const listener of this.dataListeners) listener(name, payload);
            if (name === "addon" && Array.isArray(payload?.data)) {
              this.#releases = payload.data.filter(
                (r: Release) =>
                  names.includes(r.addon) &&
                  ["release", "beta"].includes(r.channel) &&
                  typeof r.version === "string" &&
                  typeof r.url === "string",
              );
              this.#finish?.();
            }
          } catch {
            /* Malformed remote frames cannot replace the catalogue. */
          }
        } else if (frame === "41" || frame.startsWith("44")) { this.#serverBackoff = true; socket.close(); }
      };
      socket.onclose = () => {
        if (this.#socket !== socket) return;
        this.connected = false;
        auth.sessionClock.clearTimeout(this.#idle);
        this.#retry = auth.sessionClock.setTimeout(
          () => connect(token),
          Math.min(this.#serverBackoff ? 300000 : 60000, 5000 * 2 ** Math.min(20, this.#attempt++)) * (this.#serverBackoff ? 0.8 + (auth.sessionClock.random?.() ?? Math.random()) * 0.2 : 1),
        );
      };
      socket.onerror = () => {}; // Never expose credential-bearing transport errors.
    };
    auth.sessionListeners.add((token) => {
      this.reconnect = () => connect(token);
      connect(token);
    });
  }
  override async scan(installation: WowInstallation, folders: AddonFolder[]): Promise<Map<string, ScanMatch>> {
    const matches = new Map<string, ScanMatch>();
    for (const folder of folders) {
      if (folder.ignoreReason || !names.includes(folder.name)) continue;
      const addon = await this.getById(folder.name, installation);
      const latestFile = addon?.files?.find((file) => file.channelType === AddonChannelType.Stable);
      if (addon && latestFile) matches.set(folder.name, { addon, latestFile });
    }
    return matches;
  }
  override normalizeVersion(version: string): string { return version.replace(/^[vV]/, ""); }
  override permittedChannels(): AddonChannelType[] {
    return this.auth.status().channels?.includes("beta")
      ? [AddonChannelType.Stable, AddonChannelType.Beta]
      : [AddonChannelType.Stable];
  }
  override isConfigured(): boolean {
    return this.auth.signedIn;
  }
  override isValidAddonId(id: string): boolean {
    return names.includes(id);
  }
  /**
   * Change source (Catalogue.findSources) finds TradeSkillMaster by its folder:
   * it has no search, and its TOCs carry no project id.
   */
  override tocId(toc: Toc): string | undefined {
    const folder = basename(dirname(toc.filePath));
    return names.includes(folder) ? folder : undefined;
  }
  override async getAll(installation: WowInstallation, ids: string[]): Promise<GetAllResult> {
    const results = await Promise.all(ids.map((id) => this.getById(id, installation)));
    return { searchResults: results.filter((r): r is AddonSearchResult => !!r), errors: [] };
  }
  override async getById(
    id: string,
    _installation: WowInstallation,
  ): Promise<AddonSearchResult | undefined> {
    if (!this.auth.signedIn || !this.isValidAddonId(id)) return undefined;
    await this.#ready;
    if (!this.auth.signedIn) return undefined;
    const channels = this.auth.status().channels ?? ["release"];
    const releases = this.#releases
      .filter((r) => r.addon === id && channels.includes(r.channel))
      .sort((a, b) => Number(b.channel === "beta") - Number(a.channel === "beta"));
    if (!releases.length) return undefined;
    return {
      allowedChannels: this.permittedChannels(),
      externalId: id,
      name: id,
      author: "TradeSkillMaster",
      providerName: this.name,
      externalUrl: "https://www.tradeskillmaster.com",
      files: releases.map((r) => ({
        externalId: `${r.channel}/${r.version}`,
        channelType: r.channel === "beta" ? AddonChannelType.Beta : AddonChannelType.Stable,
        version: r.version.replace(/^[vV]/, ""),
        folders: [id],
        gameVersion: "",
        downloadUrl: r.url,
        releaseDate: "",
        dependencies:
          id === "TradeSkillMaster"
            ? [{ externalAddonId: names[1]!, type: AddonDependencyType.Required }]
            : [],
      })),
    };
  }
}

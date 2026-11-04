/**
 * WoW installation detection for SteamOS/Linux (project-owned).
 *
 * Informed by WowUp's warcraft-platform.{win,linux}.ts (Lutris probing and
 * the executable whitelist, GPL-3.0, commit 4fdae600 — see
 * docs/wowup-provenance.md and docs/installation-detection.md) and the
 * Deck reference notes in docs/steam-deck.md. Unlike WowUp we do not decode
 * Battle.net's product.db protobuf — on a Deck, WoW is nearly always a
 * Lutris/Bottles/Proton-prefix or plain-folder install, so directory
 * probing, Blizzard system.reg paths, Steam shortcuts and custom paths find installs.
 * Registry paths resolve through dosdevices, with case matching on Linux.
 */

import { prefixRegistryDiscoveries } from "./PrefixRegistry";
import { readSteamShortcuts, shortcutPrefixes, shortcutPrefixOverrides, isWowShortcut, type SteamShortcut } from "./SteamShortcuts";
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import type { SteamGameLink } from "../../api/contracts";
import type { WowInstallation } from "../models";
import {
  getClientTypeForFolderName,
  WOW_FLAVOR_FOLDERS,
  WOW_INTERFACE_FOLDER_NAME,
  WOW_ADDON_FOLDER_NAME,
} from "../toc/toc";
import { WowClientType } from "../types";
import { getClientTypeLabel } from "../utils/gametype";
import { isDirectory, listDirectory, pathExists, readTextFile } from "../fs/safe-fs";

export interface DetectionOptions {
  homeDir: string;
  /** User-configured paths: may be a WoW root, a flavor dir, or a prefix root. */
  customPaths?: string[];
  scanSteam?: boolean;
  scanRemovableMedia?: boolean;
  /** The user's removable media dir (default: /run/media/<user>). */
  removableMediaBase?: string;
}

const WOW_DIR_NAMES = ["world of warcraft"];

export { WOW_EXECUTABLE_NAMES } from "./WowExecutables";
import { isWowClientExecutable, isWowLaunchExecutable } from "./WowExecutables";

/**
 * Validity of a candidate flavor directory (see docs/installation-detection.md).
 *
 * - confirmed: a game executable is present — definitely a real install.
 * - likely: Battle.net-managed markers (.build.info, Data/) but no
 *   executable — usually a real install (streamed/partial downloads).
 * - addon-data: only user data (Interface/WTF) — may be a streamed install
 *   with data elsewhere, or leftovers of an uninstalled game. Never
 *   auto-registered; the user must confirm it.
 * - invalid: nothing recognizable.
 */
export type ValidityTier = "confirmed" | "likely" | "addon-data" | "invalid";

/** Where a candidate was found. */
export type DetectionSource =
  "custom" | "prefix-registry" | "steam-shortcut" | "lutris" | "steam" | "removable" | "known-path";

/** A flavor directory that looks like it may host a WoW installation. */
export interface InstallationCandidate {
  /** Absolute flavor dir path (e.g. .../World of Warcraft/_retail_). */
  location: string;
  clientType: WowClientType;
  validity: ValidityTier;
  detectionSource: DetectionSource;
}

const SOURCE_PRIORITY: Record<DetectionSource, number> = {
  custom: 0,
  "prefix-registry": 1,
  "steam-shortcut": 2,
  lutris: 3,
  steam: 4,
  removable: 5,
  "known-path": 6,
};

/** Installations at or above this tier are registered automatically. */
const AUTO_REGISTER_TIERS: readonly ValidityTier[] = ["confirmed", "likely"];

/**
 * Absolute path of Interface/AddOns for an installation.
 *
 * Note: unlike WowUp (where `location` is the game executable path), this
 * engine stores the flavor directory itself as `location`.
 */
export function getAddonsPath(installation: WowInstallation): string {
  return join(installation.location, WOW_INTERFACE_FOLDER_NAME, WOW_ADDON_FOLDER_NAME);
}

/** Stable id for an installation location so re-detection keeps ids. */
export function installationIdFor(location: string): string {
  const hasher = new Bun.CryptoHasher("md5");
  hasher.update(location.toLowerCase().replace(/\\/g, "/"));
  return hasher.digest("hex").slice(0, 12);
}

/**
 * Normalize any user-supplied path to a list of flavor installation dirs
 * found at or below it (max depth: the path itself, "World of Warcraft"
 * child, and flavor children).
 */
export async function findFlavorDirs(rootPath: string): Promise<string[]> {
  const found: string[] = [];

  const tryWoWDir = async (dir: string): Promise<void> => {
    if (!(await isDirectory(dir))) {
      return;
    }
    const entries = await listDirectory(dir);
    for (const entry of entries) {
      if (entry.isDirectory && WOW_FLAVOR_FOLDERS.includes(entry.name as never)) {
        if (getClientTypeForFolderName(entry.name) !== WowClientType.None) {
          found.push(entry.path);
        }
      }
    }
  };

  // case 1: path points directly at a flavor dir
  const baseName = rootPath.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "";
  if (WOW_FLAVOR_FOLDERS.includes(baseName as never)) {
    if (await isDirectory(rootPath)) {
      found.push(rootPath);
      return found;
    }
  }

  // case 2: path points at the WoW root
  await tryWoWDir(rootPath);

  // case 3: path is a prefix containing a WoW dir (case-insensitive)
  if (found.length === 0) {
    const entries = await listDirectory(rootPath);
    for (const entry of entries) {
      if (entry.isDirectory && WOW_DIR_NAMES.includes(entry.name.toLowerCase())) {
        await tryWoWDir(entry.path);
      }
    }
  }

  return [...new Set(found)];
}

/** Parse Steam's libraryfolders.vdf for library paths. */
export function parseLibraryFoldersVdf(content: string): string[] {
  const paths: string[] = [];
  const regex = /"path"\s+"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const p = match[1]!.replace(/\\\\/g, "\\");
    if (p && !paths.includes(p)) {
      paths.push(p);
    }
  }
  return paths;
}

export type BuildInfoRow = Record<string, string>;

/**
 * Parse Blizzard's `.build.info`: a pipe-delimited table with one row per
 * installed product. Header cells are "Name!TYPE:len" (e.g.
 * "Version!STRING:0") — only the name before "!" is a real column name.
 *
 * This file lives in the WoW *root* (one directory above every
 * `_retail_`/`_classic_era_`/... flavor dir), shared across all installed
 * flavors — not inside each flavor dir. See docs/wow-client-identity.md.
 */
export function parseBuildInfo(content: string): BuildInfoRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    return [];
  }
  const columns = lines[0]!.split("|").map((h) => h.split("!")[0]!.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split("|");
    const row: BuildInfoRow = {};
    columns.forEach((col, i) => {
      row[col] = (cells[i] ?? "").trim();
    });
    return row;
  });
}

/** Read this flavor's Product code from its own `.flavor.info`. */
async function readProductFlavor(flavorDir: string): Promise<string | undefined> {
  try {
    const text = await readTextFile(join(flavorDir, ".flavor.info"));
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    return lines[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * This flavor's row from the shared `.build.info` in the WoW root,
 * matched by Product (via `.flavor.info`). Returns undefined if either
 * file is missing or no row matches — a normal case for installs not
 * managed by Battle.net.
 */
export async function readFlavorBuildInfo(flavorDir: string): Promise<BuildInfoRow | undefined> {
  const product = await readProductFlavor(flavorDir);
  if (!product) {
    return undefined;
  }
  try {
    const text = await readTextFile(join(flavorDir, "..", ".build.info"));
    return parseBuildInfo(text).find((row) => row["Product"] === product);
  } catch {
    return undefined;
  }
}

/** Read the game version from the shared `.build.info` (best effort). */
export async function readFlavorVersion(flavorDir: string): Promise<string | undefined> {
  const row = await readFlavorBuildInfo(flavorDir);
  return row?.["Version"] || undefined;
}

export async function createInstallationForFlavorDir(
  flavorDir: string,
): Promise<WowInstallation | null> {
  const normalized = flavorDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const flavorName = normalized.split("/").pop() ?? "";
  const clientType = getClientTypeForFolderName(flavorName);
  if (clientType === WowClientType.None) {
    return null;
  }
  const version = await readFlavorVersion(normalized);
  return {
    id: installationIdFor(normalized),
    clientType,
    location: normalized,
    label: flavorName,
    displayName: getClientTypeLabel(clientType),
    selected: false,
    defaultAddonChannelType: 0,
    version,
    source: "detected",
  };
}

/**
 * Classify how trustworthy a flavor directory is as a WoW installation.
 * Evidence tiers are documented in docs/installation-detection.md; the
 * rule was validated against the reference Deck where the actively used
 * Retail flavor has no executable at all.
 */
export async function classifyFlavorDir(flavorDir: string): Promise<ValidityTier> {
  for (const entry of await listDirectory(flavorDir)) {
    if (!entry.isDirectory && isWowClientExecutable(entry.name) && await pathExists(entry.path)) {
      return "confirmed";
    }
  }
  if (await readFlavorBuildInfo(flavorDir)) {
    return "likely";
  }
  if (await isDirectory(join(flavorDir, "Data"))) {
    return "likely";
  }
  if (await isDirectory(join(flavorDir, WOW_INTERFACE_FOLDER_NAME))) {
    return "addon-data";
  }
  return "invalid";
}

export class InstallationDetector {
  private steamGames = new Map<string, SteamGameLink[]>();
  constructor(private options: DetectionOptions) {}

  /**
   * Auto-registrable installations: candidates with confirmed or likely
   * validity, converted to WowInstallation records.
   */
  async detect(): Promise<WowInstallation[]> {
    const candidates = await this.detectCandidates();
    const installations: WowInstallation[] = [];
    for (const candidate of candidates) {
      if (!AUTO_REGISTER_TIERS.includes(candidate.validity)) {
        continue;
      }
      const installation = await createInstallationForFlavorDir(candidate.location);
      if (installation) {
        const games = this.steamGames.get(candidate.location);
        if (games?.length) installation.steamGames = games;
        installations.push(installation);
      }
    }
    installations.sort((a, b) => a.clientType - b.clientType);
    return installations;
  }

  /**
   * Registry and shortcut candidates, then known locations when needed, deduplicated
   * by path with the most specific detection source kept. Includes
   * addon-data candidates so the UI can offer them for manual confirmation.
   */
  async detectCandidates(): Promise<InstallationCandidate[]> {
    this.steamGames.clear();
    const roots = await this.candidateWoWRoots();
    const byLocation = new Map<string, InstallationCandidate>();
    const allSources = new Map<string, Set<DetectionSource>>();

    const primary = roots.filter(r => ["prefix-registry", "steam-shortcut", "custom"].includes(r.source));
    const fallback = roots.filter(r => !primary.includes(r));
    primary.sort((a, b) => ["prefix-registry", "steam-shortcut", "custom"].indexOf(a.source) - ["prefix-registry", "steam-shortcut", "custom"].indexOf(b.source));
    for (const phase of [primary, fallback]) {
      if (phase === fallback) {
        if ([...byLocation.values()].some(c => AUTO_REGISTER_TIERS.includes(c.validity))) break;
        for (const path of await this.removableRoots()) phase.push({ path, source: "removable", sources: new Set(["removable"]) });
      }
      for (const { path: root, source, sources, games = [] } of phase) {
        for (const flavor of await findFlavorDirs(root)) {
          const clientType = getClientTypeForFolderName(
            flavor.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "",
          );
          if (clientType === WowClientType.None) {
            continue;
          }
          const validity = await classifyFlavorDir(flavor);
          if (validity === "invalid") {
            continue;
          }
          if (games.length) {
            const linked = new Map((this.steamGames.get(flavor) ?? []).map(g => [g.appId, g]));
            for (const game of games) linked.set(game.appId, game);
            this.steamGames.set(flavor, [...linked.values()].sort((a, b) => a.appId - b.appId));
          }
          const key = flavor.toLowerCase();
          const seen = allSources.get(key) ?? new Set<DetectionSource>();
          for (const foundSource of sources) seen.add(foundSource);
          allSources.set(key, seen);
          const existing = byLocation.get(key);
          if (!existing || SOURCE_PRIORITY[source] < SOURCE_PRIORITY[existing.detectionSource]) {
            byLocation.set(key, {
              location: flavor,
              clientType,
              validity,
              detectionSource: source,
            });
          }
        }
      }
    }

    const candidates = [...byLocation.values()].sort((a, b) => a.clientType - b.clientType);
    for (const candidate of candidates) {
      // No paths: they can contain the user's name. Flavor and sources are enough to debug.
      const sources = [...(allSources.get(candidate.location.toLowerCase()) ?? [])].sort(
        (a, b) => SOURCE_PRIORITY[a] - SOURCE_PRIORITY[b],
      );
      console.error(JSON.stringify({
        component: "detection",
        flavor: candidate.location.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop(),
        validity: candidate.validity,
        sources,
      }));
    }
    return candidates;
  }

  private async candidateWoWRoots(): Promise<Array<{ path: string; source: DetectionSource; sources: Set<DetectionSource>; games?: SteamGameLink[] }>> {
    const { homeDir, customPaths = [] } = this.options;
    const roots: Array<{ path: string; source: DetectionSource; sources: Set<DetectionSource>; games?: SteamGameLink[] }> = [];
    const shortcuts: SteamShortcut[] = [];

    const prefixes = new Set<string>();

    const addRoot = (path: string, source: DetectionSource, games: SteamGameLink[] = []): void => {
      if (!path) return;
      const existing = roots.find((r) => r.path === path);
      if (!existing) roots.push({ path, source, sources: new Set([source]), games });
      else {
        existing.sources.add(source);
        if (SOURCE_PRIORITY[source] < SOURCE_PRIORITY[existing.source]) existing.source = source;
        existing.games = [...new Map([...(existing.games ?? []), ...games].map(g => [g.appId, g])).values()];
      }
    };

    for (const custom of customPaths) {
      if (await pathExists(join(custom, "system.reg"))) prefixes.add(custom);
      // also probe common prefix layouts below a custom root
      addRoot(custom, "custom");
      addRoot(join(custom, "drive_c"), "custom");
      addRoot(join(custom, "drive_c", "Program Files (x86)"), "custom");
    }

    // Lutris-style installs (observed on the reference Deck)
    addRoot(join(homeDir, "Applications"), "lutris");
    addRoot(join(homeDir, "Games"), "lutris");

    // Lutris config library path
    const lutrisGamePaths = [join(homeDir, "Games"), ...(await this.lutrisLibraryPaths())];
    for (const lib of lutrisGamePaths) {
      for (const game of ["battlenet", "world-of-warcraft", "world-of-warcraft-classic"]) {
        prefixes.add(join(lib, game));
        addRoot(join(lib, game, "drive_c"), "lutris");
      }
    }

    // Steam proton prefixes
    if (this.options.scanSteam !== false) {
      for (const root of this.steamHomes()) {
        for (const user of await listDirectory(join(root, "userdata"))) {
          if (!user.isDirectory) continue;
          try {
            const bytes = await Bun.file(join(user.path, "config/shortcuts.vdf")).bytes();
            const parsed = readSteamShortcuts(bytes);
            shortcuts.push(...parsed);
            for (const shortcut of parsed) {
              for (const prefix of shortcutPrefixes(shortcut)) prefixes.add(prefix);
              for (const rawPath of [shortcut.exe, shortcut.startDir]) {
                const path = rawPath.trim().replace(/^"(.*)"$/, "$1");
                if (!isAbsolute(path)) continue;
                addRoot(
                  isWowLaunchExecutable(basename(path)) ? dirname(path) : path,
                  "steam-shortcut",
                  isWowShortcut(shortcut) && shortcut.name ? [{ appId: shortcut.appId, name: shortcut.name }] : [],
                );
              }
            }
          } catch {
            // Missing or malformed shortcut files cannot stop other discovery.
          }
        }
      }
      const steamRoots = await this.steamLibraryFolders();
      for (const library of steamRoots) {
        const compatRoot = join(library, "steamapps", "compatdata");
        for (const entry of await listDirectory(compatRoot)) {
          if (!entry.isDirectory && !entry.isSymlink) {
            continue;
          }
          prefixes.add(join(entry.path, "pfx"));
          const driveC = join(entry.path, "pfx", "drive_c");
          addRoot(join(driveC, "Program Files (x86)"), "steam");
          addRoot(join(driveC, "Program Files"), "steam");
          addRoot(driveC, "steam");
        }
      }
    }

    // Native and Flatpak Bottles store each prefix directly in its bottle folder.
    for (const bottles of [
      join(homeDir, ".local/share/bottles/bottles"),
      join(homeDir, ".var/app/com.usebottles.bottles/data/bottles/bottles"),
    ]) {
      for (const bottle of await listDirectory(bottles)) {
        if (bottle.isDirectory) prefixes.add(bottle.path);
      }
    }
    // Associate only recognized launchers with prefixes. Other games can share a prefix.
    const prefixGames = new Map<string, Map<number, SteamGameLink>>();
    const libraries = this.options.scanSteam === false ? [] : await this.steamLibraryFolders();
    for (const shortcut of shortcuts) {
      if (!isWowShortcut(shortcut) || !shortcut.name) continue;
      const explicit = shortcutPrefixOverrides(shortcut);
      const referenced = explicit.length ? explicit : libraries.map(lib => join(lib, "steamapps/compatdata", String(shortcut.appId), "pfx"));
      for (const reference of referenced) {
        const canonical = await realpath(reference).catch(() => undefined);
        if (!canonical) continue;
        prefixes.add(canonical);
        const games = prefixGames.get(canonical) ?? new Map<number, SteamGameLink>();
        games.set(shortcut.appId, { appId: shortcut.appId, name: shortcut.name });
        prefixGames.set(canonical, games);
        // A launcher can still locate the standard layout when its registry is missing.
        for (const folder of ["drive_c", "drive_c/Program Files (x86)", "drive_c/Program Files"]) {
          addRoot(join(canonical, folder), "steam-shortcut", [...games.values()]);
        }
      }
    }
    for (const { prefix, roots: found } of await prefixRegistryDiscoveries(prefixes)) {
      for (const path of found) addRoot(path, "prefix-registry", [...(prefixGames.get(prefix)?.values() ?? [])]);
    }

    return roots;
  }

  private async removableRoots(): Promise<string[]> {
    const roots: string[] = [];
    if (this.options.scanRemovableMedia !== false) {
      const userMedia =
        this.options.removableMediaBase ??
        join("/run/media", this.options.homeDir.replace(/\/+$/, "").split("/").pop() ?? "");
      for (const mount of await listDirectory(userMedia)) {
        if (!mount.isDirectory) {
          continue;
        }
        roots.push(mount.path);
        for (const child of await listDirectory(mount.path)) {
          if (child.isDirectory) {
            roots.push(child.path);
          }
        }
      }
    }

    return roots;
  }

  private async lutrisLibraryPaths(): Promise<string[]> {
    try {
      const cfg = join(this.options.homeDir, ".config", "lutris", "system.yml");
      const text = await readTextFile(cfg);
      const match = /game_path:\s*(.*)/.exec(text);
      if (match && match[1]) {
        return [match[1].trim()];
      }
    } catch {
      // no lutris config
    }
    return [];
  }

  private async steamLibraryFolders(): Promise<string[]> {
    const libraries = new Set<string>();
    for (const root of this.steamHomes()) {
      if (await isDirectory(root)) libraries.add(root);
      const vdf = join(root, "steamapps", "libraryfolders.vdf");
      try {
        const text = await readTextFile(vdf);
        for (const lib of parseLibraryFoldersVdf(text)) {
          libraries.add(lib);
        }
      } catch {
        // missing vdf under this root
      }
    }
    return [...libraries];
  }

  private steamHomes(): string[] {
    return [
      join(this.options.homeDir, ".local/share/Steam"),
      join(this.options.homeDir, ".steam/steam"),
    ];
  }
}

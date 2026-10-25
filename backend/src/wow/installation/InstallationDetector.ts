/**
 * WoW installation detection for SteamOS/Linux (project-owned).
 *
 * Informed by WowUp's warcraft-platform.{win,linux}.ts (Lutris probing and
 * the executable whitelist, GPL-3.0, commit 4fdae600 — see
 * docs/wowup-provenance.md and docs/installation-detection.md) and the
 * Deck reference notes in docs/steam-deck.md. Unlike WowUp we do not decode
 * Battle.net's product.db protobuf — on a Deck, WoW is nearly always a
 * Lutris/Bottles/Proton-prefix or plain-folder install, so directory
 * probing + user-configured paths cover the real cases.
 */

import { join } from "node:path";
import type { WowInstallation } from "../models";
import { getClientTypeForFolderName, WOW_FLAVOR_FOLDERS, WOW_INTERFACE_FOLDER_NAME, WOW_ADDON_FOLDER_NAME } from "../toc/toc";
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

/**
 * Known WoW client executable names (case-sensitive, as shipped by
 * Battle.net). Derived from WowUp warcraft-platform.win.ts lines 15-45
 * (identical list is used by the linux platform since the Windows client
 * runs unchanged under Wine/Proton). Presence of any of these in a flavor
 * directory is the strongest evidence of a real installation.
 */
export const WOW_EXECUTABLE_NAMES: readonly string[] = [
  "Wow.exe",
  "WowT.exe",
  "WowB.exe",
  "WowClassic.exe",
  "WowClassicT.exe",
  "WowClassicB.exe",
  "Wow-arm64.exe",
  "WowT-arm64.exe",
  "WowB-arm64.exe",
  "WowClassic-arm64.exe",
  "WowClassicT-arm64.exe",
  "WowClassicB-arm64.exe",
];

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
export type DetectionSource = "custom" | "lutris" | "steam" | "removable" | "known-path";

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
  lutris: 1,
  steam: 2,
  removable: 3,
  "known-path": 4,
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

export async function createInstallationForFlavorDir(flavorDir: string): Promise<WowInstallation | null> {
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
  for (const exe of WOW_EXECUTABLE_NAMES) {
    if (await pathExists(join(flavorDir, exe))) {
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
        installations.push(installation);
      }
    }
    installations.sort((a, b) => a.clientType - b.clientType);
    return installations;
  }

  /**
   * All flavor-directory candidates from every probed source, deduplicated
   * by path with the most specific detection source kept. Includes
   * addon-data candidates so the UI can offer them for manual confirmation.
   */
  async detectCandidates(): Promise<InstallationCandidate[]> {
    const roots = await this.candidateWoWRoots();
    const byLocation = new Map<string, InstallationCandidate>();

    for (const { path: root, source } of roots) {
      for (const flavor of await findFlavorDirs(root)) {
        const clientType = getClientTypeForFolderName(flavor.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "");
        if (clientType === WowClientType.None) {
          continue;
        }
        const validity = await classifyFlavorDir(flavor);
        if (validity === "invalid") {
          continue;
        }
        const key = flavor.toLowerCase();
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

    return [...byLocation.values()].sort((a, b) => a.clientType - b.clientType);
  }

  private async candidateWoWRoots(): Promise<Array<{ path: string; source: DetectionSource }>> {
    const { homeDir, customPaths = [] } = this.options;
    const roots: Array<{ path: string; source: DetectionSource }> = [];

    const addRoot = (path: string, source: DetectionSource): void => {
      if (path && !roots.some((r) => r.path === path)) {
        roots.push({ path, source });
      }
    };

    for (const custom of customPaths) {
      // also probe common prefix layouts below a custom root
      addRoot(custom, "custom");
      addRoot(join(custom, "drive_c"), "custom");
      addRoot(join(custom, "drive_c", "Program Files (x86)"), "custom");
    }

    // Lutris-style installs (observed on the reference Deck)
    addRoot(join(homeDir, "Applications"), "lutris");
    addRoot(join(homeDir, "Games"), "lutris");

    // Lutris config library path
    const lutrisGamePaths = await this.lutrisLibraryPaths();
    for (const lib of lutrisGamePaths) {
      addRoot(join(lib, "battlenet", "drive_c"), "lutris");
      addRoot(join(lib, "world-of-warcraft", "drive_c"), "lutris");
      addRoot(join(lib, "world-of-warcraft-classic", "drive_c"), "lutris");
    }

    // Steam proton prefixes
    if (this.options.scanSteam !== false) {
      const steamRoots = await this.steamLibraryFolders();
      for (const library of steamRoots) {
        const compatRoot = join(library, "steamapps", "compatdata");
        for (const entry of await listDirectory(compatRoot)) {
          if (!entry.isDirectory) {
            continue;
          }
          const driveC = join(entry.path, "pfx", "drive_c");
          if (await isDirectory(driveC)) {
            addRoot(join(driveC, "Program Files (x86)"), "steam");
            addRoot(driveC, "steam");
          }
        }
      }
    }

    // Removable media (SD cards) — probe one level deep
    if (this.options.scanRemovableMedia !== false) {
      const userMedia =
        this.options.removableMediaBase ?? join("/run/media", this.options.homeDir.replace(/\/+$/, "").split("/").pop() ?? "");
      for (const mount of await listDirectory(userMedia)) {
        if (!mount.isDirectory) {
          continue;
        }
        addRoot(mount.path, "removable");
        for (const child of await listDirectory(mount.path)) {
          if (child.isDirectory) {
            addRoot(child.path, "removable");
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
    const steamHome = join(this.options.homeDir, ".local", "share", "Steam");
    const roots = [steamHome, join(this.options.homeDir, ".steam", "steam")];
    const libraries = new Set<string>();
    for (const root of roots) {
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
}

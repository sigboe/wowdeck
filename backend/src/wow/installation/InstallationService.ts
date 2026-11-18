/**
 * The installation list: detection, manual adds, removal and the one active
 * installation. Persisted in the state store; addon records are touched only
 * to drop those of a removed installation.
 */

import type { FoundInstallation, Installation, InstallationPreferences } from "../../api/contracts";
import type { WowInstallation } from "../models";
import type { StateStore } from "../storage/StateStore";
import type { ProcReader } from "../wtf/GameProcessGuard";
import { NotFoundError, ValidationError } from "../errors";
import { isDirectory } from "../fs/safe-fs";
import {
  getClientFullName,
  getClientTypeLabel,
  getGameTypeForClientType,
  isLegacyAutoDisplayName,
} from "../utils/gametype";
import {
  InstallationDetector,
  classifyFlavorDir,
  createInstallationForFlavorDir,
  findFlavorDirs,
  getAddonsPath,
  installationIdFor,
} from "./InstallationDetector";

/** A user-typed folder path without trailing slashes. */
function normalizePath(path: string): string {
  return path.trim().replace(/\/+$/, "");
}

function noMarkersError(dir: string): ValidationError {
  return new ValidationError(`no WoW installation markers found in ${dir} (no executable, .build.info, Data or Interface)`);
}

/**
 * Merge found installations into the stored list by id: a known one takes
 * the new client type, location and version (plus `update`'s changes), a new
 * one is added. Nothing is ever dropped here: removal is an explicit user
 * action (WowUp's importWowInstallations), so flaky detection (an unmounted
 * SD card) never loses a selection or its addon records.
 */
function mergeInstallations(
  existing: WowInstallation[],
  found: WowInstallation[],
  update: (prior: WowInstallation, found: WowInstallation) => void = () => {},
): WowInstallation[] {
  const byId = new Map(existing.map((e) => [e.id, { ...e }]));
  for (const f of found) {
    const prior = byId.get(f.id);
    if (prior) {
      prior.clientType = f.clientType;
      prior.location = f.location;
      prior.version = f.version;
      update(prior, f);
    } else {
      byId.set(f.id, f);
    }
  }
  return [...byId.values()].sort((a, b) => a.clientType - b.clientType);
}

export class InstallationService {
  constructor(
    /** Settings and installations; addon records change only in AddonService's gate. */
    private store: Omit<StateStore, "addons">,
    /**
     * Removes an installation: AddonService.removeInstallation, one guarded
     * turn of the addon gate (after any running or queued addon change) that
     * refuses a recovery-required one (InstallationRecovery), then runs
     * `removeEntry` and drops its addon records. One turn, so no addon
     * change can stop in the installation between the check and the removal.
     */
    private removeGuarded: (installationId: string, removeEntry: () => void) => Promise<void>,
    /** Called after an installation (and its addon records) was removed. */
    private onRemoved: () => void = () => {},
    /** Where proven links are kept (the engine's data folder) and the /proc they are read from. */
    private launches: { dataDir?: string; procReader?: ProcReader } = {},
  ) {}

  #detector(homeDir: string): InstallationDetector {
    return new InstallationDetector({ homeDir, customPaths: this.store.settings.customWowPaths, ...this.launches });
  }

  /**
   * Called after a detection scan or a manual add: the list may hold an
   * installation with no update metadata yet.
   */
  readonly foundListeners = new Set<() => void>();

  #found(): void {
    for (const listener of this.foundListeners) listener();
  }

  /** Detect installations into the list; the whole list after. */
  async detect(homeDir: string): Promise<Installation[]> {
    await this.#relink(homeDir, true);
    this.#found();
    return this.listed();
  }

  /**
   * Detect, then keep every installation's Steam links as found: stale
   * shortcut links never stay. `add` false refreshes links only, adding no
   * installation (a new one would want the update check `detect` starts).
   */
  async #relink(homeDir: string, add: boolean): Promise<void> {
    const found = await this.#detector(homeDir).detect();
    const known = (f: WowInstallation) => add || this.store.installations.some((i) => i.id === f.id);
    // Keep installations through an unmounted drive, but never keep stale shortcut links.
    this.store.setInstallations(mergeInstallations(this.store.installations.map(i => ({ ...i, steamGames: [] })), found.filter(known),
      (prior, current) => { prior.steamGames = current.steamGames ?? []; }));
  }

  /**
   * A shortcut started (installations.recordLaunch): record a proven link
   * when WoW now runs from a listed installation through it, then refresh
   * the links.
   */
  async recordLaunch(homeDir: string, launch: { appId: number; accountId?: number }): Promise<{ recorded: boolean; installations: Installation[] }> {
    const recorded = await this.#detector(homeDir).recordLaunch(launch, this.store.installations.map((i) => i.location));
    if (recorded) await this.#relink(homeDir, false);
    return { recorded, installations: this.listed() };
  }

  /** The list in wire form (installations.list). */
  listed(): Installation[] {
    return this.list().map((i) => this.#wire(i));
  }

  #wire(i: WowInstallation): Installation {
    return {
      autoUpdateEnabled: i.autoUpdateEnabled ?? true,
      hidden: i.hidden ?? false,
      id: i.id,
      gameType: getGameTypeForClientType(i.clientType),
      path: i.location,
      addonsPath: getAddonsPath(i),
      displayName: i.displayName,
      clientName: getClientTypeLabel(i.clientType),
      clientFullName: getClientFullName(i.clientType),
      source: i.source ?? "detected",
      selected: i.id === this.selectedId(),
      version: i.version ?? null,
      steamGames: i.steamGames ?? [],
    };
  }

  /**
   * The stored list, migrating any legacy auto-generated `displayName` (see
   * isLegacyAutoDisplayName) to the current short name on every read, not
   * just after a detection scan: My Addons' Refresh never detects, so a fix
   * that only lived there would never reach most users. A name the user set
   * is never touched.
   */
  list(): WowInstallation[] {
    const list = this.store.installations;
    let changed = false;
    for (const i of list) {
      if (i.autoUpdateEnabled === undefined || i.hidden === undefined) {
        i.autoUpdateEnabled ??= true;
        i.hidden ??= false;
        changed = true;
      }
      if (isLegacyAutoDisplayName(i.displayName, i.clientType)) {
        i.displayName = getClientTypeLabel(i.clientType);
        changed = true;
      }
    }
    if (changed) {
      this.store.setInstallations(list);
    }
    return list;
  }

  /** The installations a folder would add (addManual's detection), registering nothing. */
  async inspect(path: string): Promise<FoundInstallation[]> {
    const normalized = normalizePath(path);
    if (!normalized.startsWith("/")) {
      return [];
    }
    const found: FoundInstallation[] = [];
    for (const dir of await findFlavorDirs(normalized).catch(() => [] as string[])) {
      const installation = await createInstallationForFlavorDir(dir).catch(() => undefined);
      if (installation) {
        found.push({ gameType: getGameTypeForClientType(installation.clientType), displayName: installation.displayName });
      }
    }
    return found;
  }

  /**
   * Add installations manually. The path may be a WoW root, a flavor dir,
   * or a prefix root (same resolution as custom scan paths).
   *
   * Validity rules (docs/installation-detection.md): confirmed/likely are
   * accepted silently; addon-data (e.g. an Interface/-only streamed install)
   * is accepted because the user explicitly confirmed it; invalid
   * directories are rejected with a useful error. A clientType override is
   * allowed for non-flavor directory layouts.
   */
  async addManual(path: string, opts: { displayName?: string; clientType?: number } = {}): Promise<Installation[]> {
    const normalized = normalizePath(path);
    if (!normalized.startsWith("/")) {
      throw new ValidationError("Enter the full folder path");
    }
    const flavorDirs = await findFlavorDirs(normalized);

    let created: WowInstallation[];
    if (flavorDirs.length > 0) {
      created = [];
      for (const dir of flavorDirs) {
        if ((await classifyFlavorDir(dir)) === "invalid") {
          throw noMarkersError(dir);
        }
        const installation = await createInstallationForFlavorDir(dir);
        if (installation) {
          installation.source = "manual";
          created.push(installation);
        }
      }
    } else if (opts.clientType !== undefined && opts.clientType >= 0) {
      // custom layout: user-supplied directory + forced client type
      if (!(await isDirectory(normalized))) {
        throw new ValidationError("That isn't a folder");
      }
      if ((await classifyFlavorDir(normalized)) === "invalid") {
        throw noMarkersError(normalized);
      }
      const label = normalized.replace(/\\/g, "/").split("/").pop() ?? normalized;
      created = [
        {
          id: installationIdFor(normalized),
          clientType: opts.clientType,
          location: normalized,
          label,
          displayName: getClientTypeLabel(opts.clientType),
          selected: false,
          defaultAddonChannelType: 0,
          source: "manual",
        },
      ];
    } else {
      throw new ValidationError(
        `${normalized} does not contain a WoW flavor directory (like _retail_); set the game type explicitly for custom layouts`,
      );
    }

    // A parent with one new installation is the same naming choice as a
    // single flavor directory. Never rename its already registered siblings.
    const fresh = created.filter(c => !this.store.installations.some(i => i.id === c.id));
    const named = created.length === 1 ? created[0] : fresh.length === 1 ? fresh[0] : undefined;
    const name = named ? opts.displayName : undefined;
    if (name && named) {
      named.displayName = name;
    }
    // Idempotent by location hash; a known installation keeps its display
    // name unless this add names it.
    this.store.setInstallations(
      mergeInstallations(this.store.installations, created, (prior) => {
        prior.source = "manual";
        if (name && prior.id === named?.id) {
          prior.displayName = name;
        }
      }),
    );
    this.#found();
    return created.map((c) => this.#wire(this.store.installations.find((e) => e.id === c.id)!));
  }

  /** Each installation for diagnostics only: `clientLabel` is a display string, never an identity. */
  summaries(): { id: string; clientLabel: string; path: string }[] {
    return this.list().map((i) => ({ id: i.id, clientLabel: getClientTypeLabel(i.clientType), path: i.location }));
  }

  /**
   * Remove an installation record (never touches WoW files). Addon records
   * belonging to it are dropped; if it was selected the selection falls
   * back to the first remaining installation.
   */
  async remove(id: string): Promise<void> {
    const installations = this.store.installations;
    if (!installations.some((i) => i.id === id)) {
      throw new NotFoundError("installation", id);
    }
    await this.removeGuarded(id, () =>
      this.store.setInstallations(this.store.installations.filter((i) => i.id !== id)),
    );
    if (this.store.settings.selectedInstallationId === id) {
      this.store.updateSettings({ selectedInstallationId: null });
      this.ensureSelection();
    }
    this.onRemoved();
  }

  /**
   * The canonical active installation. One source of truth: the persisted
   * `selectedInstallationId`. When it is unset or stale the first
   * installation is selected and the choice persisted (mirrors WowUp's
   * SessionService fallback) so the engine and UI always agree.
   */
  ensureSelection(): WowInstallation | null {
    const installations = this.store.installations;
    if (installations.length === 0) {
      return null;
    }
    const found = installations.find((i) => i.id === this.store.settings.selectedInstallationId);
    if (found) {
      return found;
    }
    const fallback = installations[0]!;
    this.store.updateSettings({ selectedInstallationId: fallback.id });
    return fallback;
  }

  update(id: string, changes: InstallationPreferences): Installation {
    const installation = this.require(id);
    for (const key of ["autoUpdateEnabled", "hidden"] as const) {
      if (changes[key] !== undefined && typeof changes[key] !== "boolean") throw new ValidationError(key + " must be a boolean");
    }
    if (changes.autoUpdateEnabled !== undefined) installation.autoUpdateEnabled = changes.autoUpdateEnabled;
    if (changes.hidden !== undefined) installation.hidden = changes.hidden;
    this.store.setInstallations(this.store.installations);
    return this.#wire(installation);
  }

  /** Installations receiving automatic checks and updates. */
  automatic(): WowInstallation[] {
    return this.list().filter((i) => i.autoUpdateEnabled !== false && !i.hidden);
  }

  selectedId(): string | null {
    return this.ensureSelection()?.id ?? null;
  }

  select(id: string): Installation {
    const installation = this.store.installations.find((i) => i.id === id);
    if (!installation) {
      throw new NotFoundError("installation", id);
    }
    this.store.updateSettings({ selectedInstallationId: id });
    return this.#wire(installation);
  }

  /**
   * The installation with this id. A missing or empty id is refused, never
   * read as the selected installation: each caller names the one it means.
   */
  require(id: string): WowInstallation {
    if (typeof id !== "string" || id === "") {
      throw new ValidationError("No WoW installation chosen. Check Options");
    }
    const installation = this.store.installations.find((i) => i.id === id);
    if (!installation) {
      throw new NotFoundError("installation", id);
    }
    return installation;
  }
}

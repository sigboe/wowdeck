/**
 * The installation list: detection, manual adds, removal and the one active
 * installation. Persisted in the state store; addon records are touched only
 * to drop those of a removed installation.
 */

import type { WowInstallation } from "../models";
import type { StateStore } from "../storage/StateStore";
import { NotFoundError, ValidationError } from "../errors";
import { isDirectory } from "../fs/safe-fs";
import { getClientTypeLabel, isLegacyAutoDisplayName } from "../utils/gametype";
import {
  InstallationDetector,
  classifyFlavorDir,
  createInstallationForFlavorDir,
  findFlavorDirs,
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
    /** Drops an installation's addon records (a gate turn, after any running install). */
    private dropRecords: (installationId: string) => Promise<void>,
    /** Called after an installation (and its addon records) was removed. */
    private onRemoved: () => void = () => {},
  ) {}

  async detect(homeDir: string): Promise<WowInstallation[]> {
    const detector = new InstallationDetector({ homeDir, customPaths: this.store.settings.customWowPaths });
    const merged = mergeInstallations(this.store.installations, await detector.detect());
    this.store.setInstallations(merged);
    return merged;
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
      if (isLegacyAutoDisplayName(i.displayName)) {
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
  async inspect(path: string): Promise<WowInstallation[]> {
    const normalized = normalizePath(path);
    if (!normalized.startsWith("/")) {
      return [];
    }
    const found: WowInstallation[] = [];
    for (const dir of await findFlavorDirs(normalized).catch(() => [] as string[])) {
      const installation = await createInstallationForFlavorDir(dir).catch(() => undefined);
      if (installation) {
        found.push(installation);
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
  async addManual(path: string, opts: { displayName?: string; clientType?: number } = {}): Promise<WowInstallation[]> {
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

    // A display name is only unambiguous when exactly one installation
    // results from this add; ignore it for multi-flavor roots.
    const name = created.length === 1 ? opts.displayName : undefined;
    if (name) {
      created[0]!.displayName = name;
    }
    // Idempotent by location hash; a known installation keeps its display
    // name unless this add names it.
    this.store.setInstallations(
      mergeInstallations(this.store.installations, created, (prior) => {
        prior.source = "manual";
        if (name) {
          prior.displayName = name;
        }
      }),
    );
    return created.map((c) => this.store.installations.find((e) => e.id === c.id)!);
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
    this.store.setInstallations(installations.filter((i) => i.id !== id));
    await this.dropRecords(id);
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

  selectedId(): string | null {
    return this.ensureSelection()?.id ?? null;
  }

  select(id: string): WowInstallation {
    const installation = this.store.installations.find((i) => i.id === id);
    if (!installation) {
      throw new NotFoundError("installation", id);
    }
    this.store.updateSettings({ selectedInstallationId: id });
    return installation;
  }

  /** The installation with this id, or the active one when no id is given. */
  require(id?: string): WowInstallation {
    const installation = id ? this.store.installations.find((i) => i.id === id) : this.ensureSelection();
    if (!installation) {
      throw new NotFoundError("installation", id ?? "<selected>");
    }
    return installation;
  }
}

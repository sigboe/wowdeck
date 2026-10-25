/**
 * JSON-file persistence for engine state (addons, installations, settings).
 * Replaces WowUp's electron-store usage (AGENTS.md rule: reimplement, tiny).
 */

import { join } from "node:path";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { PluginSettings } from "../../api/contracts";
import { defaultSettings, normalizeStoredSettings } from "./settings";
import type { WowAddon, WowInstallation } from "../models";
import { AddonRecords } from "../addons/AddonRecords";

export interface EngineState {
  installations: WowInstallation[];
  addons: WowAddon[];
  settings: PluginSettings;
  /** Random id of this plugin install, generated on first use. Not derived from hardware or hostname. */
  deviceId?: string;
}

export class StateStore {
  #state: EngineState | null = null;

  /** The addon records; the only way to read or change them. */
  readonly addons = new AddonRecords(
    () => this.load(),
    () => void this.persist(),
  );

  constructor(private statePath: string) {}

  load(): EngineState {
    if (this.#state) {
      return this.#state;
    }
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, "utf-8")) as Partial<EngineState>;
      // Files from older builds carry keys nothing reads any more; drop them
      // here so the next save doesn't write them back. Settings keep only
      // known keys, each made valid (settings.ts).
      type LegacyAddon = WowAddon & { autoUpdateEnabled?: unknown };
      this.#state = {
        installations: parsed.installations ?? [],
        addons: (parsed.addons ?? []).map(({ autoUpdateEnabled: _auto, ...addon }: LegacyAddon) => addon),
        settings: normalizeStoredSettings(parsed.settings),
        ...(typeof parsed.deviceId === "string" && parsed.deviceId ? { deviceId: parsed.deviceId } : {}),
      };
    } catch {
      this.#state = { installations: [], addons: [], settings: defaultSettings() };
    }
    return this.#state;
  }

  /**
   * Identifies this install (random, created once, persisted). Written into WTF backups so a restore
   * can tell "made on this device" from "made on another computer". Wiping the plugin's data creates a
   * new id, after which older own backups look foreign — the safe direction.
   */
  deviceId(): string {
    const state = this.load();
    if (!state.deviceId) {
      state.deviceId = crypto.randomUUID();
      void this.persist();
    }
    return state.deviceId;
  }

  get settings(): PluginSettings {
    return this.load().settings;
  }

  updateSettings(patch: Partial<PluginSettings>): PluginSettings {
    const state = this.load();
    state.settings = { ...state.settings, ...patch };
    void this.persist();
    return state.settings;
  }

  get installations(): WowInstallation[] {
    return this.load().installations;
  }

  setInstallations(installations: WowInstallation[]): void {
    this.load().installations = installations;
    void this.persist();
  }

/**
 * Persist synchronously to the state file via write-to-temp + rename.
 *
 * The state is small (KBs) and correctness depends on durability across
 * process exits: the engine may be killed (plugin reload) at any moment
 * and a queued async write would lose the most recent mutation — e.g. the
 * selected installation. Sync writes keep the file consistent
 * with memory at all times; rename keeps each write atomic.
 */
persist(): Promise<void> {
  const state = this.load();
  try {
    const tmp = `${this.statePath}.tmp-${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(state, null, 2));
    renameSync(tmp, this.statePath);
  } catch (err) {
    console.error(`[store] persist failed: ${String(err)}`);
  }
  return Promise.resolve();
}
}

export function createStateStore(dataDir: string): StateStore {
  mkdirSync(dataDir, { recursive: true });
  return new StateStore(join(dataDir, "state.json"));
}

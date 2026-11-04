/**
 * JSON-file persistence for engine state (addons, installations, settings).
 * Replaces WowUp's electron-store usage (AGENTS.md rule: reimplement, tiny).
 */

import { join } from "node:path";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import type { PluginSettings } from "../../api/contracts";
import { defaultSettings, normalizeStoredSettings } from "./settings";
import type { WowAddon, WowInstallation } from "../models";
import { AddonRecords, type AddonCommitEvidence, type AddonRecordsState, normalizeCommitEvidence } from "../addons/AddonRecords";
import { realStageFs, type FsStage, type StageFs } from "../fs/StageFs";
import { UNREADABLE_STATE_MARKER } from "../addons/TransactionMarker";

export interface EngineState {
  installations: WowInstallation[];
  addons: WowAddon[];
  settings: PluginSettings;
  /** Commit evidence of addon transactions not yet cleaned up (AddonRecords.commit); absent in older files. */
  addonCommits?: AddonCommitEvidence[];
  /**
   * Markers of addon transactions not yet resolved (AddonTransaction), kept
   * exactly as stored: a marker this build can't read must still block, so
   * nothing here is dropped on load. Absent in older files.
   */
  addonTransactions?: unknown[];
  /** Random id of this plugin install, generated on first use. Not derived from hardware or hostname. */
  deviceId?: string;
}

export class StateStore {
  #state: EngineState | null = null;

  /** The addon records; the only way to read or change them. */
  readonly addons = new AddonRecords(
    () => this.load(),
    (next, purpose) => this.#writeAddons(next, purpose),
  );

  constructor(
    private statePath: string,
    /** The filesystem addon state writes and addon transactions go through. */
    readonly fs: StageFs = realStageFs,
  ) {}

  load(): EngineState {
    if (this.#state) {
      return this.#state;
    }
    let text: string;
    try {
      text = readFileSync(this.statePath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.#state = { installations: [], addons: [], settings: defaultSettings() };
        return this.#state;
      }
      // Whatever it holds may include markers: block, and keep it as it is.
      return this.#unverifiable(`unreadable (${(err as NodeJS.ErrnoException).code ?? "error"})`);
    }
    try {
      const parsed = JSON.parse(text) as Partial<EngineState>;
      // Files from older builds carry keys nothing reads any more; drop them
      // here so the next save doesn't write them back. Settings keep only
      // known keys, each made valid (settings.ts).
      type LegacyAddon = WowAddon & { autoUpdateEnabled?: unknown };
      this.#state = {
        installations: parsed.installations ?? [],
        addons: (parsed.addons ?? []).map(({ autoUpdateEnabled: _auto, ...addon }: LegacyAddon) => addon),
        settings: normalizeStoredSettings(parsed.settings),
        ...commitsFrom(parsed.addonCommits),
        ...transactionsFrom(parsed.addonTransactions),
        ...(typeof parsed.deviceId === "string" && parsed.deviceId ? { deviceId: parsed.deviceId } : {}),
      };
    } catch {
      // A file that never named a marker can't have held one: start afresh,
      // as older builds did. One that did can't be read as "no markers".
      if (text.includes(`"addonTransactions"`)) {
        return this.#unverifiable("damaged");
      }
      this.#state = { installations: [], addons: [], settings: defaultSettings() };
    }
    return this.#state;
  }

  /** Why the state file is kept as it is (never written this run), or null when it was read. */
  #unverified: string | null = null;

  /**
   * A state file that exists but can't be read may hold transaction
   * markers. It isn't an absent one: this run starts from an empty state
   * holding one unreadable marker (UNREADABLE_STATE_MARKER), which names no
   * installation and so blocks every installation, and nothing is written
   * over the file, so the next run finds it as it is.
   */
  #unverifiable(reason: string): EngineState {
    console.error(`[store] state file ${reason}; kept as it is, addon changes refused`);
    this.#unverified = reason;
    this.#state = {
      installations: [],
      addons: [],
      settings: defaultSettings(),
      addonTransactions: [{ ...UNREADABLE_STATE_MARKER }],
    };
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
   * Write an addon record change: the current state with `next` in place,
   * written atomically; memory takes `next` only once the write succeeded.
   * Throws when the write fails, leaving both file and memory as they were.
   */
  #writeAddons(next: AddonRecordsState, purpose: "records" | "marker"): void {
    const state = this.load();
    this.#write({ ...state, ...next }, purpose === "marker" ? ["marker.write", "marker.replace"] : undefined);
    state.addons = next.addons;
    state.addonCommits = next.addonCommits;
    state.addonTransactions = next.addonTransactions;
  }

  #writes = 0;

  /** Write-to-temp + rename of `state`; throws on failure, removing the temp copy. */
  #write(state: EngineState, [writeStage, replaceStage]: [FsStage, FsStage] = ["state.write", "state.replace"]): void {
    const { addonCommits, addonTransactions, ...rest } = state;
    // Written only when there is evidence or a marker, so a state file
    // without transactions keeps its shape.
    const stored = {
      ...rest,
      ...(addonCommits?.length && { addonCommits }),
      ...(addonTransactions?.length && { addonTransactions }),
    };
    if (this.#unverified) {
      throw new Error(`The state file is ${this.#unverified}, so it isn't replaced`);
    }
    const tmp = `${this.statePath}.tmp-${process.pid}-${(this.#writes += 1)}`;
    try {
      this.fs.writeFileSync(writeStage, tmp, JSON.stringify(stored, null, 2));
      this.fs.renameSync(replaceStage, tmp, this.statePath);
    } catch (err) {
      rmSync(tmp, { force: true });
      throw err;
    }
  }

  /**
   * Persist synchronously to the state file via write-to-temp + rename.
   *
   * The state is small (KBs) and correctness depends on durability across
   * process exits: the engine may be killed (plugin reload) at any moment
   * and a queued async write would lose the most recent mutation — e.g. the
   * selected installation. Sync writes keep the file consistent
   * with memory at all times; rename keeps each write atomic.
   *
   * Settings, installations and the device id go through here, which logs a
   * failed write and carries on; addon record writes report theirs
   * (`#writeAddons`).
   */
  persist(): Promise<void> {
    try {
      this.#write(this.load());
    } catch (err) {
      console.error(`[store] persist failed: ${String(err)}`);
    }
    return Promise.resolve();
  }
}

/**
 * Stored markers, exactly as stored. Something there that isn't a list is
 * kept as one unreadable marker, so it blocks rather than reads as none.
 */
function transactionsFrom(stored: unknown): Pick<EngineState, "addonTransactions"> {
  if (stored === undefined || stored === null) {
    return {};
  }
  const markers = Array.isArray(stored) ? (stored as unknown[]) : [stored];
  return markers.length ? { addonTransactions: markers } : {};
}

/** Stored commit evidence, malformed entries dropped; nothing when there is none. */
function commitsFrom(stored: unknown): Pick<EngineState, "addonCommits"> {
  const commits = Array.isArray(stored)
    ? stored.map(normalizeCommitEvidence).filter((c): c is AddonCommitEvidence => c !== null)
    : [];
  return commits.length ? { addonCommits: commits } : {};
}

/** The engine's store under `dataDir`; `fs` is the real filesystem except in fault-injection tests. */
export function createStateStore(dataDir: string, fs: StageFs = realStageFs): StateStore {
  mkdirSync(dataDir, { recursive: true });
  return new StateStore(join(dataDir, "state.json"), fs);
}

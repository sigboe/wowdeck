import type { Addon, Installation } from "./types";
import { createStore, type Store } from "./store";
import {
  createAddonActions,
  type AddonActionDeps,
  type AddonActions,
  type ListChange,
} from "./addonActions";
import { canQuickUpdate } from "./addonRow";
import { resetBrowseSessionState } from "./browseSessionState";
import { plural } from "./text";

/**
 * The installations and the active installation's addons, kept at module
 * scope. Opening any modal or context menu unmounts the QAM panel (guide G4;
 * DEVICE 2026-10-16: the row's Options menu too). Held in the panel, the list
 * came back empty after every menu and stayed empty while an install from
 * that menu ran (the reload waited for it), the row spinner was lost, and
 * "Show ignored" reset itself. Here the remounted panel shows the last list,
 * the rows still working and the same filters at once, then reloads. The text
 * filter is set from a modal, so it has to live here anyway.
 */
export interface AddonSessionState {
  installations: Installation[];
  /** The engine's active installation; the addon list belongs to it. */
  selectedId: string | null;
  addons: Addon[];
  /** Requests reading the list right now (list or provider refresh). */
  loads: number;
  /** Addon ids with an action running (update, reinstall, channel switch, …). */
  busy: Readonly<Record<string, true>>;
  /** Null, or which Update all runs: this installation or every one (WF-13). */
  updatingAll: null | "installation" | "all";
  showIgnored: boolean;
  /** My Addons text filter (WF-06); blank shows everything. */
  filter: string;
}

export type AddonSessionDeps = Pick<
  AddonActionDeps,
  "rpc" | "toast" | "toastError" | "autoUpdateOn"
>;

export interface AddonSession extends Pick<Store<AddonSessionState>, "get" | "subscribe"> {
  /**
   * Every addon action. Each applies the addon the engine returns; the list
   * is read again, once, when the last running action needs it.
   */
  actions: AddonActions;
  /**
   * The engine's "addons changed" event. A change an action is making is left
   * to that action (the engine announces it before it answers); any other
   * change reads the list again, after the running actions end.
   */
  addonsChanged(addonIds: readonly string[]): void;
  setFilter(filter: string): void;
  setShowIgnored(showIgnored: boolean): void;
  /** Re-read the installations; the engine says which one is active. */
  reloadInstallations(): Promise<void>;
  /** Re-read the active installation's addons (no provider calls). */
  reloadAddons(): Promise<void>;
  /** Re-scan folders and ask the providers for new releases. */
  refreshFromProviders(): Promise<void>;
  reloadAll(): Promise<void>;
  /**
   * Make another installation the active one. The kept addon list and the
   * Get Addons results belong to the previous one, so both are reset.
   */
  selectInstallation(id: string): Promise<void>;
}

export function createAddonSession(deps: AddonSessionDeps): AddonSession {
  const store = createStore<AddonSessionState>({
    installations: [],
    selectedId: null,
    addons: [],
    loads: 0,
    busy: {},
    updatingAll: null,
    showIgnored: false,
    filter: "",
  });
  const { rpc, toast, toastError } = deps;

  /** One list read, counted so overlapping reads keep the spinner until the last ends. */
  const trackLoad = async <T>(read: () => Promise<T>): Promise<T> => {
    store.patch({ loads: store.get().loads + 1 });
    try {
      return await read();
    } finally {
      store.patch({ loads: store.get().loads - 1 });
    }
  };

  // Orders list reads against rows an action applied: a read that started
  // before the apply answers with the row as it was, and must not bring it back.
  let clock = 0;
  const appliedAt = new Map<string, number>();

  // Actions running per addon: a row is busy while any runs on it, and until
  // the change the last one made is on screen.
  const runningOn = new Map<string, number>();
  const idle = (ids: readonly string[]) => {
    const busy = { ...store.get().busy };
    for (const id of ids) {
      if (!runningOn.get(id)) {
        delete busy[id];
      }
    }
    return busy;
  };

  /**
   * One list read. `release`: rows whose action waited for it, idle in the
   * same render as their new state. Such a read shows on those rows, not on
   * the list's refresh button.
   */
  const readAddons = async (release: readonly string[] = []) => {
    try {
      const started = ++clock;
      const list = () => rpc("addons.list");
      const { addons: read } = await (release.length ? list() : trackLoad(list));
      const shown = new Map(store.get().addons.map((a) => [a.id, a]));
      const addons = read.map((a) =>
        (appliedAt.get(a.id) ?? 0) > started ? (shown.get(a.id) ?? a) : a,
      );
      store.patch({ addons, busy: idle(release) });
    } catch (e) {
      store.patch({ busy: idle(release) });
      // The last list stays on screen; the toast says it may be stale.
      toastError("Couldn't load addons", e);
    }
  };
  const reloadAddons = () => readAddons();

  const reloadInstallations = async () => {
    try {
      const { installations } = await rpc("installations.list");
      // The engine is the single source of truth for the active
      // installation; never derived from list order.
      const selectedId = installations.find((i) => i.selected)?.id ?? null;
      store.patch({ installations, selectedId });
    } catch {
      // engine not ready
    }
  };

  // Actions running, whether the list must be read when the last ends, and
  // the rows waiting for that read.
  let running = 0;
  let reloadWanted = false;
  let awaitingRead: string[] = [];
  // Resolves when that read has landed: an action ends with its change on screen.
  let readLanded: { promise: Promise<void>; resolve: () => void } | null = null;
  const landed = () => {
    if (!readLanded) {
      let resolve!: () => void;
      const promise = new Promise<void>((r) => (resolve = r));
      readLanded = { promise, resolve };
    }
    return readLanded.promise;
  };

  const begin = (addonId?: string) => {
    running++;
    if (addonId) {
      runningOn.set(addonId, (runningOn.get(addonId) ?? 0) + 1);
      store.patch({ busy: { ...store.get().busy, [addonId]: true } });
    }
  };

  const settle = (change: ListChange, addonId?: string): Promise<void> | undefined => {
    running--;
    let onScreen: Promise<void> | undefined;
    const ended = addonId ? [addonId] : [];
    if (addonId) {
      runningOn.set(addonId, runningOn.get(addonId)! - 1);
    }
    const { addons } = store.get();
    if (change === null) {
      if (ended.length) {
        store.patch({ busy: idle(ended) });
      }
    } else if (change !== "reload" && addons.some((a) => a.id === change.id)) {
      appliedAt.set(change.id, ++clock);
      store.patch({
        addons: addons.map((a) => (a.id === change.id ? keepListFields(a, change) : a)),
        busy: idle(ended),
      });
    } else {
      // Only a list read shows this change: the row stays busy until it lands.
      reloadWanted = true;
      awaitingRead.push(...ended);
      onScreen = landed();
    }
    if (running === 0 && reloadWanted) {
      reloadWanted = false;
      const release = awaitingRead;
      const done = readLanded;
      awaitingRead = [];
      readLanded = null;
      void readAddons(release).then(() => done?.resolve());
    }
    return onScreen;
  };

  const actions = createAddonActions({
    ...deps,
    setUpdatingAll: (updatingAll) => store.patch({ updatingAll }),
    begin,
    settled: settle,
  });

  return {
    get: store.get,
    subscribe: store.subscribe,
    actions,
    setFilter: (filter) => store.patch({ filter: filter.trim() }),
    setShowIgnored: (showIgnored) => store.patch({ showIgnored }),
    reloadInstallations,
    reloadAddons,
    addonsChanged(addonIds) {
      const { busy } = store.get();
      // No ids: the engine can't say which (an installation changed).
      if (addonIds.length > 0 && addonIds.every((id) => busy[id])) {
        return;
      }
      if (running > 0) {
        reloadWanted = true;
      } else {
        void reloadAddons();
      }
    },
    // addons.list only re-reads persisted records and scans for unmanaged
    // folders; only addons.refresh asks the providers, so only it can find a
    // new update.
    async refreshFromProviders() {
      try {
        const { addons, failed } = await trackLoad(() => rpc("addons.refresh"));
        store.patch({ addons });
        if (failed > 0) {
          toast(`Couldn't check ${plural(failed, "addon")} for updates`, "Try again later");
        }
      } catch (e) {
        toastError("Couldn't check for updates", e);
      }
    },
    async reloadAll() {
      await reloadInstallations();
      await reloadAddons();
    },
    async selectInstallation(id) {
      try {
        // The engine's selection first, so the two never disagree.
        await rpc("installations.select", { installationId: id });
        store.patch({ selectedId: id, addons: [] });
        // Get Addons results depend on the installation's game version.
        resetBrowseSessionState();
        await reloadAddons();
      } catch (e) {
        toastError("Couldn't switch installation", e);
        void reloadInstallations();
      }
    },
  };
}

/**
 * An addon the engine returned for one action, in place of its row. Only the
 * list reads the TOC on disk and who needs whom; the single addon carries
 * those empty, so the row keeps its own.
 */
function keepListFields(row: Addon, returned: Addon): Addon {
  return {
    ...returned,
    interfaceVersion: row.interfaceVersion,
    dependencies: row.dependencies,
    optionalDependencies: row.optionalDependencies,
    missingDependencies: row.missingDependencies,
    neededBy: row.neededBy,
    gameVersion: row.gameVersion,
  };
}

/** The installed addon a provider result stands for, matched by provider and id. */
export function installedAddonFor(
  addons: readonly Addon[],
  result: { providerId: string; externalId: string },
): Addon | null {
  return (
    addons.find((a) => a.providerId === result.providerId && a.externalId === result.externalId) ??
    null
  );
}

/** Get Addons' status tags for a result: whether it is installed, and recently updated. */
export function resultTags(installed: Addon | null): string[] {
  if (!installed) {
    return [];
  }
  return [
    canQuickUpdate(installed) ? "Update available" : "Installed",
    ...(installed.newlyUpdated ? ["Updated"] : []),
  ];
}

/**
 * What X does on a Get Addons result; null when it does nothing: installed,
 * nothing to update, and not reinstallable (a direct link, a source turned off).
 */
export function resultInstallLabel(
  installed: Addon | null,
): "Install" | "Reinstall" | "Update" | null {
  if (!installed) {
    return "Install";
  }
  if (canQuickUpdate(installed)) {
    return "Update";
  }
  return installed.canReinstall ? "Reinstall" : null;
}

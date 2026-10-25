import type { Addon, Installation } from "./types";
import { createStore, type Store } from "./store";
import { createAddonActions, type AddonActionDeps, type AddonActions } from "./addonActions";
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
  /** Every addon action; each one reloads the list when it ends. */
  actions: AddonActions;
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

  const reloadAddons = async () => {
    try {
      const { addons } = await trackLoad(() => rpc("addons.list"));
      store.patch({ addons });
    } catch (e) {
      // The last list stays on screen; the toast says it may be stale.
      toastError("Couldn't load addons", e);
    }
  };

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

  const actions = createAddonActions({
    ...deps,
    setBusy(id, on) {
      const busy = { ...store.get().busy };
      if (on) {
        busy[id] = true;
      } else {
        delete busy[id];
      }
      store.patch({ busy });
    },
    setUpdatingAll: (updatingAll) => store.patch({ updatingAll }),
    onChanged: () => void reloadAddons(),
  });

  return {
    get: store.get,
    subscribe: store.subscribe,
    actions,
    setFilter: (filter) => store.patch({ filter: filter.trim() }),
    setShowIgnored: (showIgnored) => store.patch({ showIgnored }),
    reloadInstallations,
    reloadAddons,
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

import type {
  Addon,
  GameType,
  Installation,
  InstallationPreferences,
  RecoveryRetryResult,
  RecoveryVerifyResult,
  StateFileRecoveryStatus,
  ReleaseChannel,
  SearchResult,
  UpdateAllProgress,
} from "./types";
import { createStore, type Store } from "./store";
import {
  createAddonActions,
  type AddonActionDeps,
  type AddonActions,
  type ListChange,
} from "./addonActions";
import { canQuickUpdate, type SessionActionId } from "./addonRow";
import { resetBrowseSessionState } from "./browseSessionState";
import { plural } from "./text";
import { retryRecoveredToast, verifiedToast } from "./recovery";

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
  /** Find WoW survives tab changes and picker round-trips. */
  findingWow: boolean;
  findWowResult: string | null;
  /** Addon ids with an action running (update, reinstall, channel switch, …). */
  busy: Readonly<Record<string, true>>;
  /**
   * Get Addons results being installed, by `resultKey`: from before
   * the install call until the list read that shows the outcome has run.
   * Kept here so every view of a result (Results, Details, a remounted QAM)
   * shows it pending, and a second install of it is refused.
   */
  installing: Readonly<Record<string, true>>;
  /**
   * Installs started outside the session's own actions, running now
   * (count): the TradeSkillMaster panel, From a file, an imported addon
   * list, the companion offer. Installation switching waits for them like
   * it waits for a catalogue install.
   */
  installingElsewhere: number;
  /**
   * An installation switch is underway: from before its selection call until
   * its list read has settled. Catalogue installs are refused meanwhile, so
   * views show them unavailable.
   */
  switching: boolean;
  /**
   * Null, or the Update all that runs: this installation or every one
   * (WF-13), and how far the engine says it has got (#253): null while it
   * is still checking, before its first addons.updateAllProgress.
   */
  updatingAll: null | { scope: "installation" | "all"; progress: UpdateAllProgress | null };
  showIgnored: boolean;
  /** My Addons text filter (WF-06); blank shows everything. */
  filter: string;
  /**
   * Installations the engine says are recovery required (ADR 0006): an
   * addon change couldn't put its files back. Read from the engine on every
   * installation reload, so it survives view changes and plugin reloads.
   */
  recoveryRequired: Readonly<Record<string, true>>;
  /**
   * Whether the engine could read its saved state file. One it can't read
   * pauses addon changes everywhere and leaves no installation listed, so
   * the notice shows it on its own (stateFileRecoveryFor).
   */
  stateFile: StateFileRecoveryStatus;
  /** The engine marked the shown list unverified: stored records, not checked against the folders. */
  addonsUnverified: boolean;
}

/** Why the saved state file can't be read and what to do, or null when it was read. */
export function stateFileRecoveryFor(
  state: AddonSessionState,
): { reason: string; nextStep: string } | null {
  const { stateFile } = state;
  return stateFile.status === "unreadable"
    ? { reason: stateFile.reason, nextStep: stateFile.nextStep }
    : null;
}

/** The active installation when it is recovery required, else null. */
export function recoveryNeededFor(state: AddonSessionState): Installation | null {
  const id = state.selectedId;
  return (id && state.recoveryRequired[id] && state.installations.find((i) => i.id === id)) || null;
}

export type AddonSessionDeps = Pick<
  AddonActionDeps,
  "rpc" | "toast" | "toastError" | "autoUpdateOn" | "afterUpdateAll"
>;

export interface AddonSession extends Pick<Store<AddonSessionState>, "get" | "subscribe"> {
  /**
   * Every addon action. Each applies the addon the engine returns; the list
   * is read again, once, when the last running action needs it.
   */
  actions: AddonActions;
  /**
   * Run a row action that needs no UI, by id: the engine call, its toast
   * and the row's busy flag. The actions that open something first —
   * Details, Folders, the channel menu, Find source, Remove's confirmation —
   * stay with the view, which sends everything else here.
   */
  run(addon: Addon, action: SessionActionId): void;
  /**
   * The engine's "addons changed" event. A change an action is making is left
   * to that action (the engine announces it before it answers); any other
   * change reads the list again, after the running actions end.
   */
  addonsChanged(addonIds: readonly string[]): void;
  /** The engine's addons.updateAllProgress; ignored with no Update all running. */
  updateAllProgress(progress: UpdateAllProgress): void;
  setFilter(filter: string): void;
  setShowIgnored(showIgnored: boolean): void;
  /** Re-read the installations; the engine says which one is active. */
  reloadInstallations(): Promise<void>;
  /** Re-read the active installation's addons (no provider calls). */
  reloadAddons(): Promise<void>;
  /** Re-scan folders and ask the providers for new releases (the selected installation; see rescanInstallation). */
  refreshFromProviders(): Promise<"refreshed" | "recovery">;
  reloadAll(): Promise<void>;
  findWow(): Promise<void>;
  /**
   * Change one installation's preferences — Auto updates, Hide and Unhide
   * (`installations.update`). Reads the installations again, so every
   * picker shows the engine's answer; the caller gets it back to show.
   */
  updateInstallation(
    installationId: string,
    changes: InstallationPreferences,
  ): Promise<Installation>;
  /** Remove one installation (`installations.remove`; its files stay). Reads both lists again. */
  removeInstallation(installationId: string): Promise<void>;
  /**
   * Add a picked folder's installations (`installations.add`, Add WoW
   * folder and its Add installation modal). Reads both lists again and
   * answers with every installation the folder holds, as the engine does.
   */
  addInstallation(params: {
    path: string;
    displayName?: string;
    clientType?: GameType;
  }): Promise<Installation[]>;
  /**
   * Re-scan one installation: folders and providers, the same path as the
   * My Addons refresh. A recovery-required installation is not asked — the
   * engine refuses it there — and answers "recovery" instead: the recovery
   * state is what shows, never a refusal toasted as an error.
   */
  rescanInstallation(installationId: string): Promise<"refreshed" | "recovery">;
  /**
   * An install the session's own actions didn't start (the
   * TradeSkillMaster panel, From a file, an imported addon list, the
   * companion offer): the caller's call runs under the session, which
   * holds installation switching for it, reads the recovery state again
   * when the answer says recovery, and reads the shown list again once it
   * settles. `install` makes the engine call; its result handling and
   * toasts stay with the caller.
   */
  installElsewhere<T>(installationId: string, install: () => Promise<T>): Promise<T>;
  /**
   * Make another installation the active one. The kept addon list and the
   * Get Addons results belong to the previous one, so both are reset.
   */
  selectInstallation(id: string): Promise<void>;
  /**
   * Retry recovery in one installation (ADR 0006, #108). The engine checks
   * and decides; this reads the recovery status and the list again, toasts
   * a recovery, and hands back the engine's answer for the details view
   * (null when the call itself failed, toasted).
   */
  retryRecovery(installationId: string): Promise<RecoveryRetryResult | null>;
  /**
   * Verify recovery in one installation after a manual repair (#109), the
   * same way: the engine checks and decides, this reads the status and
   * list again, toasts a verified repair and hands back the answer (null
   * when the call itself failed, toasted).
   */
  verifyRecovery(installationId: string): Promise<RecoveryVerifyResult | null>;
}

export function createAddonSession(deps: AddonSessionDeps): AddonSession {
  const store = createStore<AddonSessionState>({
    installations: [],
    selectedId: null,
    addons: [],
    loads: 0,
    findingWow: false,
    findWowResult: null,
    busy: {},
    installing: {},
    installingElsewhere: 0,
    switching: false,
    updatingAll: null,
    showIgnored: false,
    filter: "",
    recoveryRequired: {},
    stateFile: { status: "readable" },
    addonsUnverified: false,
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
    const installationId = store.get().selectedId;
    if (!installationId) {
      // No installation, no addons: nothing to ask the engine.
      store.patch({ addons: [], busy: idle(release), addonsUnverified: false });
      return;
    }
    try {
      const started = ++clock;
      const list = () => rpc("addons.list", { installationId });
      const { addons: read, unverified } = await (release.length ? list() : trackLoad(list));
      if (store.get().selectedId !== installationId) return;
      const shown = new Map(store.get().addons.map((a) => [a.id, a]));
      const addons = read.map((a) =>
        (appliedAt.get(a.id) ?? 0) > started ? (shown.get(a.id) ?? a) : a,
      );
      const { recoveryRequired } = store.get();
      store.patch({
        addons,
        busy: idle(release),
        addonsUnverified: unverified === true,
        // The list answers for the installation it named: unverified means recovery required there.
        ...(unverified && {
          recoveryRequired: { ...recoveryRequired, [installationId]: true as const },
        }),
      });
    } catch (e) {
      if (store.get().selectedId !== installationId) return;
      store.patch({ busy: idle(release) });
      // The last list stays on screen; the toast says it may be stale.
      toastError("Couldn't load addons", e);
    }
  };
  const reloadAddons = () => readAddons();

  /** The engine's recovery status; one that can't be read keeps the last. */
  const reloadRecovery = async () => {
    try {
      const { installations, stateFile } = await rpc("installations.recoveryStatus");
      const recoveryRequired: Record<string, true> = {};
      for (const i of installations) {
        if (i.status === "recoveryRequired") {
          recoveryRequired[i.installationId] = true;
        }
      }
      // An engine from before the state-file status doesn't send it.
      store.patch({ recoveryRequired, stateFile: stateFile ?? { status: "readable" } });
    } catch {
      // engine not ready
    }
  };

  const reloadInstallations = async () => {
    void reloadRecovery();
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
        addons: addons.map((a) => (a.id === change.id ? change : a)),
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

  // An action that leaves (or meets) recovery required reads the status
  // again, so the notice appears without waiting for a reload.
  const watchedRpc = (async (...args: Parameters<typeof rpc>) => {
    try {
      const result: unknown = await rpc(...args);
      if (mentionsRecovery(result)) {
        await reloadRecovery();
      }
      return result;
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === "recovery_required") {
        await reloadRecovery();
      }
      throw e;
    }
  }) as typeof rpc;

  const shared = createAddonActions({
    ...deps,
    rpc: watchedRpc,
    // None: the engine refuses the call, and the action says it couldn't.
    installationId: () => store.get().selectedId ?? "",
    setUpdatingAll: (scope) => store.patch({ updatingAll: scope && { scope, progress: null } }),
    begin,
    settled: settle,
  });

  // Pending installs stay apart from `running`: the list read an install
  // waits for is scheduled by `running` alone, so it never waits on them.
  const setInstalling = (key: string, pending: boolean) => {
    const installing = { ...store.get().installing };
    if (pending) {
      installing[key] = true;
    } else {
      delete installing[key];
    }
    store.patch({ installing });
  };
  const actions: AddonActions = {
    ...shared,
    /**
     * One Update all at a time, from any view (#252): the engine's progress
     * event names no run, so a second run would mix its counts into the
     * first's bar. A press while one runs starts nothing and is not queued.
     */
    async updateAll(scope) {
      if (store.get().updatingAll) {
        return;
      }
      await shared.updateAll(scope);
    },
    /**
     * One install per result at a time, whichever view or release channel
     * asks: a repeat while it is pending sends nothing and is not queued.
     */
    async install(result: SearchResult, channel?: ReleaseChannel) {
      const key = resultKey(result);
      // During a switch the result may belong to the previous installation:
      // refused, not queued.
      if (store.get().switching || store.get().installing[key]) {
        return;
      }
      setInstalling(key, true);
      try {
        // Resolves after its list read, whether that read succeeded or not.
        await shared.install(result, channel);
      } finally {
        setInstalling(key, false);
      }
    },
  };

  // addons.list only re-reads persisted records and scans for unmanaged
  // folders; only addons.refresh asks the providers, so only it can find a
  // new update. A recovery-required installation is not asked: the engine
  // refuses refreshes there, and the stored list is what there is.
  const rescanInstallation = async (installationId: string): Promise<"refreshed" | "recovery"> => {
    if (!installationId) {
      return "refreshed";
    }
    if (store.get().recoveryRequired[installationId]) {
      // The recovery state is what shows (its notice sits above every
      // tab), never a refusal toasted as an error.
      if (installationId === store.get().selectedId) {
        await readAddons();
      }
      await reloadRecovery();
      return "recovery";
    }
    try {
      const { addons, failed } = await trackLoad(() => rpc("addons.refresh", { installationId }));
      if (installationId === store.get().selectedId) {
        store.patch({ addons });
      }
      if (failed > 0) {
        toast(`Couldn't check ${plural(failed, "addon")} for updates`, "Try again later");
      }
    } catch (e) {
      if ((e as { code?: unknown } | null)?.code === "recovery_required") {
        await reloadRecovery();
        if (installationId === store.get().selectedId) await readAddons();
        return "recovery";
      }
      toastError("Couldn't check for updates", e);
    }
    return "refreshed";
  };

  const reloadAll = async () => {
    await reloadInstallations();
    await reloadAddons();
  };

  return {
    get: store.get,
    subscribe: store.subscribe,
    actions,
    run(addon, action) {
      switch (action) {
        case "update":
          void actions.update(addon);
          return;
        case "reinstall":
          void actions.reinstall(addon);
          return;
        case "rollback":
          void actions.rollback(addon);
          return;
        case "pauseAuto":
          void actions.setAutoUpdatePaused(addon, true);
          return;
        case "resumeAuto":
          void actions.setAutoUpdatePaused(addon, false);
          return;
        case "ignore":
          void actions.setIgnored(addon, true);
          return;
        case "unignore":
          void actions.setIgnored(addon, false);
          return;
      }
    },
    setFilter: (filter) => store.patch({ filter: filter.trim() }),
    setShowIgnored: (showIgnored) => store.patch({ showIgnored }),
    reloadInstallations,
    reloadAddons,
    updateAllProgress(progress) {
      const { updatingAll } = store.get();
      if (updatingAll) {
        store.patch({ updatingAll: { ...updatingAll, progress } });
      }
    },
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
    refreshFromProviders: () => rescanInstallation(store.get().selectedId ?? ""),
    async updateInstallation(installationId, changes) {
      const { installation } = await rpc("installations.update", {
        installationId,
        ...changes,
      });
      await reloadInstallations();
      return installation;
    },
    async removeInstallation(installationId) {
      await rpc("installations.remove", { installationId });
      // The engine picks the next active installation when this one was it.
      await reloadAll();
    },
    async addInstallation(params) {
      const { installations } = await rpc("installations.add", params);
      await reloadAll();
      return installations;
    },
    rescanInstallation,
    async installElsewhere(installationId, install) {
      store.patch({ installingElsewhere: store.get().installingElsewhere + 1 });
      try {
        const result = await install();
        if (mentionsRecovery(result)) {
          await reloadRecovery();
        }
        return result;
      } catch (e) {
        if ((e as { code?: unknown } | null)?.code === "recovery_required") {
          await reloadRecovery();
        }
        throw e;
      } finally {
        // The shown list is read again once the install has settled,
        // whether its own addons.changed event landed mid-install or not.
        if (installationId === store.get().selectedId) {
          await readAddons();
        }
        store.patch({ installingElsewhere: store.get().installingElsewhere - 1 });
      }
    },
    async findWow() {
      if (store.get().findingWow) {
        return;
      }
      store.patch({ findingWow: true, findWowResult: null });
      try {
        const { installations } = await rpc("installations.detect");
        const result = `Found ${plural(installations.length, "installation")}`;
        store.patch({ findWowResult: result });
        toast(result);
        await reloadInstallations();
        await reloadAddons();
      } catch (e) {
        store.patch({
          findWowResult: "Couldn't find WoW. Try again, or add its folder.",
        });
        toastError("Couldn't find installations", e);
      } finally {
        store.patch({ findingWow: false });
      }
    },
    reloadAll,
    async retryRecovery(installationId) {
      let result: RecoveryRetryResult;
      try {
        result = await rpc("installations.retryRecovery", { installationId });
      } catch (e) {
        toastError("Couldn't retry recovery", e);
        return null;
      }
      await reloadRecovery();
      if (result.status === "recovered") {
        const name =
          store.get().installations.find((i) => i.id === installationId)?.displayName ??
          "The installation";
        const { title, body } = retryRecoveredToast(name, result);
        toast(title, body);
      }
      if (result.restored.length > 0 && installationId === store.get().selectedId) {
        await reloadAddons();
      }
      return result;
    },
    async verifyRecovery(installationId) {
      let result: RecoveryVerifyResult;
      try {
        result = await rpc("installations.verifyRecovery", { installationId });
      } catch (e) {
        toastError("Couldn't verify recovery", e);
        return null;
      }
      await reloadRecovery();
      if (result.status === "verified") {
        const name =
          store.get().installations.find((i) => i.id === installationId)?.displayName ??
          "The installation";
        const { title, body } = verifiedToast(name, result);
        toast(title, body);
      }
      if (result.verified.length > 0 && installationId === store.get().selectedId) {
        await reloadAddons();
      }
      return result;
    },
    async selectInstallation(id) {
      // Also guards a selector opened before an install started: refused,
      // with no selection RPC, and not replayed later.
      if (store.get().switching || installationSwitchBlocked(store.get())) {
        return;
      }
      // Synchronous, so no install slips in between.
      store.patch({ switching: true });
      try {
        // The engine's selection first, so the two never disagree.
        await rpc("installations.select", { installationId: id });
        store.patch({ selectedId: id, addons: [] });
        // Get Addons results depend on the installation's game version.
        resetBrowseSessionState();
        await reloadAddons();
      } catch (e) {
        toastError("Couldn't switch installation", e);
        // Part of the switch: it ends once this attempt has settled.
        await reloadInstallations();
      } finally {
        store.patch({ switching: false });
      }
    },
  };
}

/**
 * Whether an action's answer says an operation is (or was refused as)
 * recovery required, a dependency or library it ran included
 * (`followUps`, #110).
 */
function mentionsRecovery(result: unknown): boolean {
  const { operation, operations } = (result ?? {}) as { operation?: unknown; operations?: unknown };
  const required = (op: unknown): boolean => {
    const { recoveryRequired, followUps } = (op ?? {}) as {
      recoveryRequired?: unknown;
      followUps?: unknown;
    };
    return recoveryRequired === true || (Array.isArray(followUps) && followUps.some(required));
  };
  return [operation, ...(Array.isArray(operations) ? operations : [])].some(required);
}

/** A catalogue result's identity: provider and external addon ID. */
export interface ResultRef {
  providerId: string;
  externalId: string;
}

/**
 * The result's key among rows and pending installs. The release channel is
 * only a choice for an install, not part of the identity.
 */
export function resultKey(result: ResultRef): string {
  return `${result.providerId}:${result.externalId}`;
}

/**
 * Why installation selectors are off right now, or null when switching is
 * allowed. A pending catalogue install settles on the installation whose list
 * the session shows, and so does an install started elsewhere (the
 * TradeSkillMaster panel, a file, an imported list, the companion), so
 * switching waits for every one to settle. Derived from the installs alone:
 * it never lifts any other restriction.
 */
export function installationSwitchBlocked(
  state: Pick<AddonSessionState, "installing" | "installingElsewhere">,
): string | null {
  return Object.keys(state.installing).length > 0 || state.installingElsewhere > 0
    ? "Wait for addon installs to finish."
    : null;
}

/** The result is being installed (from any view). */
export function isInstallPending(
  state: Pick<AddonSessionState, "installing">,
  result: ResultRef,
): boolean {
  return !!state.installing[resultKey(result)];
}

/**
 * What every view of a Get Addons result shows, read from the session's
 * current state: the installed addon it stands for, its tags, what X does,
 * and whether it is working (installing, or its installed addon busy), when
 * X and the release channel menu are unavailable.
 */
export function catalogueResult(
  state: Pick<AddonSessionState, "addons" | "busy" | "installing">,
  result: ResultRef,
) {
  const installed = installedAddonFor(state.addons, result);
  return {
    installed,
    tags: resultTags(installed),
    installLabel: resultInstallLabel(installed),
    pending: isInstallPending(state, result) || (!!installed && !!state.busy[installed.id]),
  };
}

/** The installed addon a provider result stands for, matched by provider and id. */
export function installedAddonFor(addons: readonly Addon[], result: ResultRef): Addon | null {
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
  installationCount = 1,
): "Install" | "Find WoW install" | "Reinstall" | "Update" | null {
  if (installationCount === 0) {
    return "Find WoW install";
  }
  if (!installed) {
    return "Install";
  }
  if (canQuickUpdate(installed)) {
    return "Update";
  }
  return installed.canReinstall ? "Reinstall" : null;
}

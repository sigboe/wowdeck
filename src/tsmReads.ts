import type { Rpc } from "./services/envelope";
import { sourcesStore } from "./sourcesStore";
import { backendErrorMessage } from "./errors";
import { systemClock, type Clock } from "./clock";
import { engine } from "./engineLink";
import { createKeyedResource } from "./keyedResource";
import type {
  EventMap,
  MethodMap,
  TradeSkillMasterAccount,
  TradeSkillMasterAuthStatus,
  TradeSkillMasterDestination,
  TradeSkillMasterItemIcons,
  TradeSkillMasterItemIconsParams,
  TradeSkillMasterLedger,
  TradeSkillMasterLedgerItemsPage,
  TradeSkillMasterLedgerItemsParams,
} from "../backend/src/api/contracts";
import { useResource } from "./useResource";
import {
  ledgerFilters,
  ledgerParams,
  ledgerPlotWidth,
  settleLedgerFilters,
  type LedgerFilters,
} from "./tsmLedgerFilters";
import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * What the TradeSkillMaster views read from the engine, one keyed resource
 * each: a view that reads follows the resource's freshness rules instead of
 * guarding its own request. The account-wide reads share one key.
 */
const ACCOUNT_KEY = "account";

/** The Ledger resource's key for an installation, a filter selection and the graph's plot width. */
const ledgerKey = (installationId: string, filters: LedgerFilters, plotWidth?: number) =>
  JSON.stringify({ installationId, filters, plotWidth });
type LedgerKey = { installationId: string; filters: LedgerFilters; plotWidth?: number };

export function createTsmModule(deps: {
  rpc: Rpc;
  clock: Clock;
  reloadSources(): Promise<void>;
  sessionEnded?(): void;
}) {
  let previous: TradeSkillMasterAuthStatus["state"] | undefined;
  const status = createKeyedResource<TradeSkillMasterAuthStatus>({
    read: () => deps.rpc("tradeskillmaster.status"),
    errorText: (e) => {
      backendErrorMessage(e);
      return "Couldn't read the TradeSkillMaster sign-in";
    },
    clock: deps.clock,
    pollMs: 1000,
    onData: (_key, data) => {
      if (data.state === "signedOut" && previous !== "signedOut") deps.sessionEnded?.();
      if (data.state !== previous) void deps.reloadSources();
      previous = data.state;
    },
  });
  const account = createKeyedResource<TradeSkillMasterAccount>({
    read: () => deps.rpc("tradeskillmaster.account", {}),
    errorText: (e) => {
      backendErrorMessage(e);
      return "Couldn't load followed realms";
    },
    clock: deps.clock,
  });
  const destination = createKeyedResource<TradeSkillMasterDestination>({
    read: (installationId) => deps.rpc("tradeskillmaster.destination", { installationId }),
    errorText: (e) => {
      backendErrorMessage(e);
      return "Couldn't load auction data";
    },
    clock: deps.clock,
  });
  // The records read WoW's saved files only: no sign-in, no network. One key
  // per installation and filter selection (ledgerKey). Viewed records read
  // again when the engine reports a save or a game state change. The minute
  // poll still moves period edges as records age and covers missed events.
  // Switching between the Dashboard and the Ledger reads nothing again: a
  // save invalidates every key (ledgerChanged), and the poll restarts with
  // the view (DEVICE 2026-11-26, LEDGER-PILL-2).
  const ledger = createKeyedResource<TradeSkillMasterLedger>({
    pollMs: 60_000,
    revalidateOnReturn: false,
    read: (key) => {
      const { installationId, filters, plotWidth } = JSON.parse(key) as LedgerKey;
      return deps.rpc("tradeskillmaster.ledger", {
        installationId,
        ...ledgerParams(filters),
        ...(plotWidth !== undefined ? { plotWidth } : {}),
      });
    },
    onData: (key, data) => {
      const { installationId, filters, plotWidth } = JSON.parse(key) as LedgerKey;
      const settled = settleLedgerFilters(installationId, filters, data);
      // The answer is already the settled selection's: no second read.
      if (settled) ledger.put(ledgerKey(installationId, settled, plotWidth), data);
    },
    errorText: (e) => {
      backendErrorMessage(e);
      return "Couldn't read TradeSkillMaster's records";
    },
    clock: deps.clock,
  });
  const ledgerItems = createKeyedResource<TradeSkillMasterLedgerItemsPage>({
    revalidateOnReturn: false,
    read: (key) =>
      deps.rpc(
        "tradeskillmaster.ledgerItems",
        JSON.parse(key) as TradeSkillMasterLedgerItemsParams,
      ),
    errorText: (e) => {
      backendErrorMessage(e);
      return "Couldn't load Ledger items";
    },
    clock: deps.clock,
  });
  // Icons are read from the game's files on each call and never saved: one
  // page's icons are kept, as its rows are (useTsmItemIcons). A file the game
  // lacks only leaves its slot empty, so a failed read shows no error.
  const itemIcons = createKeyedResource<TradeSkillMasterItemIcons>({
    revalidateOnReturn: false,
    read: (key) =>
      deps.rpc("tradeskillmaster.itemIcons", JSON.parse(key) as TradeSkillMasterItemIconsParams),
    errorText: (e) => {
      backendErrorMessage(e);
      return "Couldn't read item icons";
    },
    clock: deps.clock,
  });
  const cleanupPreview = createKeyedResource<TradeSkillMasterAccount["follows"]>({
    read: (installationId) => deps.rpc("tradeskillmaster.cleanupPreview", { installationId }),
    errorText: (e) => {
      backendErrorMessage(e);
      return "Couldn't preview account cleanup";
    },
    clock: deps.clock,
  });
  const addons = createKeyedResource<MethodMap["addons.list"]["result"]>({
    read: (installationId) => deps.rpc("addons.list", { installationId }),
    errorText: (e) => {
      backendErrorMessage(e);
      return "Couldn't read installed addons";
    },
    clock: deps.clock,
  });
  return {
    addons,
    addonsChanged() {
      addons.invalidate();
    },
    status,
    account,
    destination,
    ledger,
    ledgerItems,
    itemIcons,
    ledgerChanged({ installationId }: EventMap["tradeskillmaster.ledgerChanged"]) {
      const matches = (key: string) =>
        (JSON.parse(key) as LedgerKey).installationId === installationId;
      ledger.invalidate(matches);
      ledgerItems.invalidate(matches);
    },
    cleanupPreview,
    /**
     * The engine's TradeSkillMaster state moved. Auction data moves often (every
     * push), so only status and destinations read again then; the account comes
     * with the event when its follows changed, never as another API read.
     */
    changed(change: EventMap["tradeskillmaster.changed"] = {}) {
      status.invalidate();
      destination.invalidate();
      if (change.account) {
        account.put(ACCOUNT_KEY, change.account);
        cleanupPreview.invalidate();
        void deps.reloadSources();
      }
    },
    async signOut() {
      status.put(ACCOUNT_KEY, await deps.rpc("tradeskillmaster.signOut"));
      void deps.reloadSources();
    },
    async cancel() {
      status.put(ACCOUNT_KEY, await deps.rpc("tradeskillmaster.cancel"));
      void deps.reloadSources();
    },
  };
}

let sessionEnded = () => {};
export const onTsmSessionEnded = (notify: () => void) => {
  sessionEnded = notify;
};

export const tsmModule = createTsmModule({
  rpc: engine.rpc,
  clock: systemClock,
  reloadSources: sourcesStore.load,
  sessionEnded: () => sessionEnded(),
});
export const {
  status: tsmStatus,
  account,
  destination: tsmDestination,
  cleanupPreview: tsmCleanupPreview,
} = tsmModule;
engine.events.on("tradeskillmaster.changed", tsmModule.changed);
engine.events.on("tradeskillmaster.ledgerChanged", tsmModule.ledgerChanged);
engine.events.on("addons.changed", tsmModule.addonsChanged);
export const useTsmAddons = (installationId: string) =>
  useResource(tsmModule.addons, installationId);

export const useTsmStatus = () => useResource(tsmStatus, ACCOUNT_KEY);
export const putTsmAccount = (data: TradeSkillMasterAccount) => account.put(ACCOUNT_KEY, data);
export const useTsmAccount = () => useResource(account, ACCOUNT_KEY);
export const useTsmDestination = (installationId: string) =>
  useResource(tsmDestination, installationId);
/**
 * The records for the installation's current filters (the Dashboard and
 * the Ledger share them), the gold graph sampled for
 * the plot width laid out last. While another selection or width reads,
 * `data` stays the last answer this view showed, so the filter bar and the
 * figures stay in place instead of flashing empty.
 */
export function useTsmLedger(installationId: string) {
  const filters = useSyncExternalStore(ledgerFilters.subscribe, () =>
    ledgerFilters.get(installationId),
  );
  const plotWidth = useSyncExternalStore(ledgerPlotWidth.subscribe, ledgerPlotWidth.get);
  const snapshot = useResource(tsmModule.ledger, ledgerKey(installationId, filters, plotWidth));
  const last = useRef<TradeSkillMasterLedger | null>(null);
  if (snapshot.data) {
    last.current = snapshot.data;
  }
  return { ...snapshot, data: snapshot.data ?? last.current };
}
/**
 * The Ledger's page last shown stays while another view shows, so coming
 * back shows it at once instead of a reading line (DEVICE 2026-11-26,
 * LEDGER-PILL-2). Another page or selection forgets it: one page is kept.
 */
let shownItemsKey: string | null = null;
export function useTsmLedgerItems(params: TradeSkillMasterLedgerItemsParams) {
  const key = JSON.stringify(params);
  const snapshot = useResource(tsmModule.ledgerItems, key);
  useEffect(() => {
    if (shownItemsKey !== null && shownItemsKey !== key) {
      tsmModule.ledgerItems.forget(shownItemsKey);
    }
    shownItemsKey = key;
  }, [key]);
  return snapshot;
}
/**
 * The icons of one Ledger page's textures, `size` device pixels wide; null
 * `params` reads nothing. Another page forgets the last one's icons.
 */
let shownIconsKey: string | null = null;
export function useTsmItemIcons(params: TradeSkillMasterItemIconsParams | null) {
  const key = params ? JSON.stringify(params) : null;
  const snapshot = useResource(tsmModule.itemIcons, key);
  useEffect(() => {
    if (shownIconsKey !== null && shownIconsKey !== key) tsmModule.itemIcons.forget(shownIconsKey);
    shownIconsKey = key;
  }, [key]);
  return snapshot;
}
export const useTsmCleanupPreview = (installationId: string) =>
  useResource(tsmCleanupPreview, installationId);

/** An action's answer for the status: shown at once, ahead of the next poll. */
export const putTsmStatus = (status: TradeSkillMasterAuthStatus) =>
  tsmStatus.put(ACCOUNT_KEY, status);
/** An action's answer for an installation's destination. */
export const putTsmDestination = (installationId: string, data: TradeSkillMasterDestination) =>
  tsmDestination.put(installationId, data);
/** Forget an installation's cleanup preview (its dialog closed). */
export const forgetTsmCleanupPreview = (installationId: string) =>
  tsmCleanupPreview.forget(installationId);

/** Drop everything read so far, so the next view starts empty (tests). */
export function resetTsmReads(): void {
  for (const resource of [
    tsmStatus,
    account,
    tsmDestination,
    tsmCleanupPreview,
    tsmModule.addons,
    tsmModule.ledger,
    tsmModule.ledgerItems,
    tsmModule.itemIcons,
  ]) {
    resource.retainOnly([]);
  }
}

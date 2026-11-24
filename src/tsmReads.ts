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
  TradeSkillMasterLedger,
} from "../backend/src/api/contracts";
import { useResource } from "./useResource";

/**
 * What the TradeSkillMaster views read from the engine, one keyed resource
 * each: a view that reads follows the resource's freshness rules instead of
 * guarding its own request. The account-wide reads share one key.
 */
const ACCOUNT_KEY = "account";

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
  // The Ledger reads WoW's saved files only: no sign-in, no network.
  const ledger = createKeyedResource<TradeSkillMasterLedger>({
    read: (installationId) => deps.rpc("tradeskillmaster.ledger", { installationId }),
    errorText: (e) => {
      backendErrorMessage(e);
      return "Couldn't read TradeSkillMaster's records";
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
engine.events.on("addons.changed", tsmModule.addonsChanged);
export const useTsmAddons = (installationId: string) =>
  useResource(tsmModule.addons, installationId);

export const useTsmStatus = () => useResource(tsmStatus, ACCOUNT_KEY);
export const putTsmAccount = (data: TradeSkillMasterAccount) => account.put(ACCOUNT_KEY, data);
export const useTsmAccount = () => useResource(account, ACCOUNT_KEY);
export const useTsmDestination = (installationId: string) =>
  useResource(tsmDestination, installationId);
export const useTsmLedger = (installationId: string) =>
  useResource(tsmModule.ledger, installationId);
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
  ]) {
    resource.retainOnly([]);
  }
}

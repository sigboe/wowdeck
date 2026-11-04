import { useCallback, useSyncExternalStore } from "react";
import * as api from "./services/backend";
import { systemClock } from "./clock";
import type { KeyedResource, ResourceSnapshot } from "./keyedResource";
import { addonSession } from "./session";
import { settingsStore } from "./settings";
import type { WtfCopySourcesResult, WtfListResult } from "./types";
import { createWtfLifecycle, type WtfOperationSnapshot } from "./wtfLifecycle";

/** The one Settings backup lifecycle (wtfLifecycle.ts), wired to the engine. */
export const wtfLifecycle = createWtfLifecycle({
  rpc: api.rpc,
  clock: systemClock,
  writeSettings: settingsStore.write,
  readSettings: settingsStore.load,
});

// An installation that is gone keeps no lists, and late answers can't refill them.
let installations = addonSession.get().installations;
addonSession.subscribe(() => {
  const next = addonSession.get().installations;
  if (next !== installations) {
    installations = next;
    wtfLifecycle.retainInstallations(next.map((i) => i.id));
  }
});

/** One installation's view of a resource: mounting makes the view a viewer. */
function useResource<T>(
  resource: KeyedResource<T>,
  installationId: string | null,
): ResourceSnapshot<T> & { refresh: () => Promise<void> } {
  const subscribe = useCallback(
    (listener: () => void) => resource.subscribe(installationId, listener),
    [resource, installationId],
  );
  const snapshot = useSyncExternalStore(subscribe, () => resource.get(installationId));
  const refresh = useCallback(
    () => (installationId ? resource.refresh(installationId) : Promise.resolve()),
    [resource, installationId],
  );
  return { ...snapshot, refresh };
}

/**
 * One installation's backup list, for a view. Mounting makes the view a
 * viewer (shared polling, revalidation on return); `refresh` is Retry and the
 * read after an action.
 */
export function useBackupList(installationId: string | null): ResourceSnapshot<WtfListResult> & {
  refresh: () => Promise<void>;
} {
  return useResource(wtfLifecycle.backupList, installationId);
}

/**
 * One installation's copy sources (the other versions Settings copy can bring
 * settings from), with the same viewer rules as `useBackupList`.
 */
export function useCopySources(
  installationId: string | null,
): ResourceSnapshot<WtfCopySourcesResult> & { refresh: () => Promise<void> } {
  return useResource(wtfLifecycle.copySources, installationId);
}

/**
 * The operation slot, running job, latest outcome and per-installation
 * feedback, for a view. Actions go through `wtfLifecycle` directly.
 */
export function useWtfOperation(): WtfOperationSnapshot {
  return useSyncExternalStore(wtfLifecycle.operation.subscribe, wtfLifecycle.operation.get);
}

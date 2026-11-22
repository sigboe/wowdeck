import { useSyncExternalStore } from "react";
import { engine } from "./engineLink";
import { pluginToast } from "./toast";
import { wtfCompletedToast } from "./wtfOutcome";
import { systemClock } from "./clock";
import type { ResourceSnapshot } from "./keyedResource";
import { useResource } from "./useResource";
import { addonSession } from "./session";
import { settingsStore } from "./settings";
import type { WtfCopySourcesResult, WtfListResult } from "./types";
import { createWtfLifecycle, type WtfOperationSnapshot } from "./wtfLifecycle";

/** The one Settings backup lifecycle (wtfLifecycle.ts), wired to the engine. */
export const wtfLifecycle = createWtfLifecycle({
  rpc: engine.rpc,
  clock: systemClock,
  writeSettings: settingsStore.write,
  readSettings: settingsStore.load,
});

// WTF backup and restore jobs run in the engine and outlive any panel or
// modal: their progress and outcome reach the lifecycle at module scope.
engine.events.on("wtf.progress", (params) =>
  wtfLifecycle.handleEvent({ event: "wtf.progress", params }),
);
engine.events.on("wtf.completed", (params) => {
  wtfLifecycle.handleEvent({ event: "wtf.completed", params });
  const toast = wtfCompletedToast(params);
  if (toast) {
    pluginToast(toast.title, toast.body);
  }
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

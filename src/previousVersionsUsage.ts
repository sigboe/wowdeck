/**
 * The kept previous versions' space as the Options row and its modal share
 * it (the pure wording lives in previousVersions.ts).
 */
import { useSyncExternalStore } from "react";
import { systemClock } from "./clock";
import { engine } from "./engineLink";
import { createKeyedResource } from "./keyedResource";
import { createStore } from "./store";
import type { PreviousVersionsUsage } from "./previousVersions";
import { formatBytes } from "./text";
import { pluginToast, toastError } from "./toast";
import { useResource } from "./useResource";

const USAGE_KEY = "all";

/**
 * The space kept previous versions use, shared by the Options row and its
 * modal: the panel is torn down while the modal is open (G4), and a clear
 * there must show on the row too.
 */
const usage = createKeyedResource<PreviousVersionsUsage>({
  read: () => engine.rpc("rollback.status"),
  errorText: () => "Couldn't load previous versions",
  clock: systemClock,
});

const clearing = createStore({ clearing: false });

/** The kept versions' space, loaded while a view is mounted; `refresh` is Try again. */
export function usePreviousVersionsUsage() {
  return useResource(usage, USAGE_KEY);
}

/** Whether Clear is running; it finishes even if the modal closes first. */
export function usePreviousVersionsClearing(): boolean {
  return useSyncExternalStore(clearing.subscribe, clearing.get).clearing;
}

/** Drop what was loaded, so the next view starts empty (tests). */
export function resetPreviousVersions(): void {
  usage.forget(USAGE_KEY);
  clearing.set({ clearing: false });
}

export async function clearPreviousVersions(): Promise<void> {
  clearing.set({ clearing: true });
  try {
    const before = usage.get(USAGE_KEY).data;
    usage.put(USAGE_KEY, await engine.rpc("rollback.clear"));
    pluginToast(
      "Previous versions cleared",
      before
        ? `${formatBytes(before.bytes)} freed`
        : "Rollback is no longer possible for earlier updates",
    );
  } catch (e) {
    toastError("Couldn't clear", e);
  } finally {
    clearing.set({ clearing: false });
  }
}

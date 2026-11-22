import { useCallback, useSyncExternalStore } from "react";
import type { KeyedResource, ResourceSnapshot } from "./keyedResource";

/**
 * One key's view of a keyed resource, the way every component reads engine
 * data: mounting makes the view a viewer (shared polling, revalidation on
 * return), a null key shows nothing, and `refresh` is Retry or the read after
 * an action. Stale answers are the resource's concern, never the component's.
 */
export function useResource<T>(
  resource: KeyedResource<T>,
  key: string | null,
): ResourceSnapshot<T> & { refresh: () => Promise<void> } {
  const subscribe = useCallback(
    (listener: () => void) => resource.subscribe(key, listener),
    [resource, key],
  );
  const snapshot = useSyncExternalStore(subscribe, () => resource.get(key));
  const refresh = useCallback(
    () => (key ? resource.refresh(key) : Promise.resolve()),
    [resource, key],
  );
  return { ...snapshot, refresh };
}

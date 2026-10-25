/**
 * Module-scope state with subscribers, for what must outlive the panel: Decky
 * unmounts it for every modal and menu (guide G4), and some state (Steam's
 * page band, WTF jobs) is read while the QAM is closed. Components read a
 * store with `useSyncExternalStore(store.subscribe, store.get)`.
 */
export interface Store<T> {
  /** The current state: the same object until it changes (`useSyncExternalStore` needs that). */
  get(): T;
  /** Replace the state; subscribers hear of it unless it is the same object. */
  set(next: T): void;
  /** Replace some fields. */
  patch(changes: Partial<T>): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const set = (next: T): void => {
    if (next === state) {
      return;
    }
    state = next;
    listeners.forEach((l) => l());
  };
  return {
    get: () => state,
    set,
    patch: (changes) => set({ ...state, ...changes }),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

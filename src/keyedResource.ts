import type { Clock } from "./clock";

/** What a view shows for one key: never another key's data. */
export interface ResourceSnapshot<T> {
  /** The last successful answer, kept through later failures. */
  readonly data: T | null;
  /** Why the newest settled read failed; only a later success clears it. */
  readonly error: string | null;
  /** An explicit read (first load, Retry, after an action) is running. */
  readonly loading: boolean;
}

/**
 * One engine read per key (an installation id), kept at module scope so it
 * survives the panel and modal teardown every modal causes (guide G4).
 *
 * Freshness rules every caller goes through, mounted or not:
 * - newest request wins; an older answer never replaces a newer one;
 * - `forget` drops a key's state, and answers already on their way are ignored;
 * - each key with viewers has one poll loop, however many viewers; the loop
 *   stops when the last viewer leaves, and the next first viewer revalidates;
 * - `invalidate` reads only viewed keys; the rest wait, stale, for a viewer;
 * - a failed read keeps the last data beside the error.
 */
export interface KeyedResource<T> {
  /** The key's snapshot: the same object until it changes. A null key is always empty. */
  get(key: string | null): ResourceSnapshot<T>;
  /** Become a viewer of `key`. Returns the unsubscribe. A null key subscribes to nothing. */
  subscribe(key: string | null, listener: () => void): () => void;
  /** Read now, showing `loading` (Retry, after an action). Resolves when this read settles. */
  refresh(key: string): Promise<void>;
  /**
   * What is known for the keys `affects` picks (every key without it) may be
   * out of date: older answers are ignored, viewed keys read again, and an
   * unviewed key is marked stale and read only once someone views it.
   */
  invalidate(affects?: (key: string) => boolean): void;
  /** Drop every key not in `keys` (an installation went away). */
  retainOnly(keys: readonly string[]): void;
}

export interface KeyedResourceOptions<T> {
  read(key: string): Promise<T>;
  /** Viewer-facing text for a failed read. */
  errorText(error: unknown): string;
  clock: Clock;
  pollMs: number;
  /** Taken when a read is sent and handed to `onData` with its answer, to order it against other state. */
  stamp?(): number;
  /** Called with each answer that is applied (stale answers are not), with the read's `stamp`. */
  onData?(key: string, data: T, stamp: number): void;
}

const EMPTY: ResourceSnapshot<never> = Object.freeze({ data: null, error: null, loading: false });

interface Entry<T> {
  snapshot: ResourceSnapshot<T>;
  /** Id of the newest request; answers carrying another id are stale. */
  latest: number;
  inFlight: number;
  /** Explicit requests still running; `loading` is true while any is. */
  explicit: Set<number>;
  /** Invalidated with no read since: a read still in flight answers too old. */
  stale: boolean;
  listeners: Set<() => void>;
  timer: unknown;
}

export function createKeyedResource<T>(options: KeyedResourceOptions<T>): KeyedResource<T> {
  const entries = new Map<string, Entry<T>>();
  let nextRequest = 1;

  const entryFor = (key: string): Entry<T> => {
    let entry = entries.get(key);
    if (!entry) {
      entry = {
        snapshot: EMPTY,
        latest: 0,
        inFlight: 0,
        explicit: new Set(),
        stale: false,
        listeners: new Set(),
        timer: null,
      };
      entries.set(key, entry);
    }
    return entry;
  };

  const update = (entry: Entry<T>, changes: Partial<ResourceSnapshot<T>>) => {
    const next = { ...entry.snapshot, ...changes };
    const prev = entry.snapshot;
    if (next.data === prev.data && next.error === prev.error && next.loading === prev.loading) {
      return;
    }
    entry.snapshot = next;
    entry.listeners.forEach((l) => l());
  };

  const read = async (key: string, explicit: boolean): Promise<void> => {
    const entry = entryFor(key);
    const id = nextRequest++;
    entry.latest = id;
    entry.stale = false;
    entry.inFlight++;
    if (explicit) {
      entry.explicit.add(id);
      update(entry, { loading: true }); // the error stays until a read succeeds
    }
    const current = () => entries.get(key) === entry && entry.latest === id;
    const stamp = options.stamp?.() ?? 0;
    try {
      const data = await options.read(key);
      if (current()) {
        update(entry, { data, error: null });
        options.onData?.(key, data, stamp);
      }
    } catch (e) {
      if (current()) {
        update(entry, { error: options.errorText(e) });
      }
    } finally {
      entry.inFlight--;
      // Whoever superseded this request, it no longer holds `loading` up.
      if (entry.explicit.delete(id)) {
        update(entry, { loading: entry.explicit.size > 0 });
      }
    }
  };

  /** No read is out, or the ones out started before an invalidation. */
  const needsRead = (entry: Entry<T>) => entry.inFlight === 0 || entry.stale;

  const poll = (key: string) => {
    if (needsRead(entryFor(key))) {
      void read(key, false);
    }
  };

  return {
    get: (key) => (key === null ? EMPTY : (entries.get(key)?.snapshot ?? EMPTY)),
    subscribe(key, listener) {
      if (key === null) {
        return () => {};
      }
      const entry = entryFor(key);
      entry.listeners.add(listener);
      if (entry.listeners.size === 1) {
        entry.timer = options.clock.setInterval(() => poll(key), options.pollMs);
        // Returning to a key revalidates it; the first load shows as loading.
        if (needsRead(entry)) {
          void read(key, entry.snapshot.data === null);
        }
      }
      return () => {
        if (
          entry.listeners.delete(listener) &&
          entry.listeners.size === 0 &&
          entry.timer !== null
        ) {
          options.clock.clearInterval(entry.timer);
          entry.timer = null;
        }
      };
    },
    refresh: (key) => read(key, true),
    invalidate(affects = () => true) {
      for (const [key, entry] of entries) {
        if (!affects(key)) {
          continue;
        }
        entry.latest = nextRequest++;
        entry.stale = true;
        if (entry.listeners.size > 0) {
          void read(key, true);
        }
      }
    },
    retainOnly(keys) {
      for (const [key, entry] of [...entries]) {
        if (keys.includes(key)) {
          continue;
        }
        entries.delete(key);
        if (entry.listeners.size > 0) {
          // Still viewed: start again empty, keeping its viewers and poll loop.
          const fresh = entryFor(key);
          fresh.listeners = entry.listeners;
          fresh.timer = entry.timer;
          entry.listeners.forEach((l) => l());
        }
      }
    },
  };
}

import { lstatSync, readdirSync, watch } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { WowInstallation } from "../models";
import { detectGameRunning, type GameRunning } from "../wtf/GameProcessGuard";
import { LEDGER_SAVED_FILE } from "./Ledger";
import { safePath } from "./SavedVariables";

const SAVE_QUIET_MS = 300;
const GAME_POLL_MS = 5_000;

interface Clock {
  setTimeout(callback: () => void | Promise<void>, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
const systemClock: Clock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms).unref(),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

type WatchDirectory = (
  path: string,
  onChange: (name: string | null) => void,
  onError: () => void,
) => { close(): void };

const watchDirectory: WatchDirectory = (path, onChange, onError) => {
  const watcher = watch(path, { persistent: false }, (_event, name) => onChange(name));
  watcher.on("error", onError);
  return watcher;
};

export interface LedgerWatchOptions {
  clock?: Clock;
  watchDirectory?: WatchDirectory;
  gameRunning?: () => Promise<GameRunning>;
}

function isDirectory(path: string): boolean {
  try { return lstatSync(path).isDirectory(); } catch { return false; }
}

function directoryIdentity(path: string): string | null {
  try {
    const stat = lstatSync(path, { bigint: true });
    return stat.isDirectory() ? `${stat.dev}:${stat.ino}` : null;
  } catch { return null; }
}

function watchFailed(reason: string): void {
  console.error(JSON.stringify({ component: "ledger-watch", reason }));
}

/** Watch one active installation until its selection or the engine session ends. */
export function watchLedger(
  { location }: WowInstallation,
  changed: () => void,
  { clock = systemClock, watchDirectory: subscribe = watchDirectory, gameRunning = detectGameRunning }: LedgerWatchOptions = {},
): () => void {
  const watchers = new Map<string, { identity: string; subscription: ReturnType<WatchDirectory> }>();
  let retryTree = false;
  let closed = false;
  let debounce: unknown;
  let processPoll: unknown;
  let treeChanged = false;
  let wasRunning: boolean | undefined;

  function saved(rebind: boolean): void {
    treeChanged ||= rebind;
    if (debounce !== undefined) clock.clearTimeout(debounce);
    debounce = clock.setTimeout(() => {
      debounce = undefined;
      if (treeChanged) {
        treeChanged = false;
        bindTree();
      }
      changed();
    }, SAVE_QUIET_MS);
  }

  function closeWatchers(): void {
    for (const { subscription } of watchers.values()) subscription.close();
    watchers.clear();
  }

  // Watch directories so a temp-file rename cannot leave a watch attached
  // to an old inode. Listen to each parent before enumerating its children,
  // so a new account or an entire WTF tree is noticed on the first save.
  function bindTree(): void {
    closeWatchers();
    retryTree = false;
    const listen = (dir: string, affects: (name: string) => boolean, rebind = true) => {
      const identity = directoryIdentity(dir);
      if (identity === null) return false;
      try {
        const watcher = subscribe(
          dir,
          (name) => {
            if (watchers.get(dir)?.subscription === watcher && (name === null || affects(name))) {
              saved(rebind);
            }
          },
          () => {
            if (watchers.get(dir)?.subscription === watcher) {
              retryTree = true;
              watchers.delete(dir);
              watcher.close();
              watchFailed("watch-lost");
            }
          },
        );
        watchers.set(dir, { identity, subscription: watcher });
      } catch {
        retryTree = true;
        watchFailed("watch-unavailable");
      }
      return true;
    };

    const parent = dirname(location);
    if (!safePath(parent) || !listen(parent, (name) => name === basename(location))) {
      retryTree = true;
      return;
    }
    if (!listen(location, (name) => name === "WTF")) return;
    const wtf = join(location, "WTF");
    if (!listen(wtf, (name) => name === "Account")) return;
    const root = join(wtf, "Account");
    const accounts = new Set<string>();
    if (!listen(root, (name) => name !== "SavedVariables" &&
      (accounts.has(name) || isDirectory(join(root, name))))) return;
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === "SavedVariables") continue;
        accounts.add(entry.name);
        const account = join(root, entry.name);
        if (listen(account, (name) => name === "SavedVariables")) {
          listen(join(account, "SavedVariables"), (name) => name === LEDGER_SAVED_FILE, false);
        }
      }
    } catch {
      // WoW or a settings restore can replace the tree during enumeration.
      retryTree = true;
    }
  }

  // A directory watch follows its original inode. Mounts and replacements
  // above that directory can leave it attached without a notification.
  function recoverTree(): boolean {
    const previous = new Map([...watchers].map(([path, { identity }]) => [path, identity]));
    if (!retryTree && [...previous].every(([path, identity]) => directoryIdentity(path) === identity)) {
      return false;
    }
    bindTree();
    return previous.size !== watchers.size ||
      [...watchers].some(([path, { identity }]) => previous.get(path) !== identity);
  }

  async function pollGame(): Promise<void> {
    let running: boolean;
    try {
      running = (await gameRunning()) === "running";
    } catch {
      running = false;
      watchFailed("process-check-failed");
    }
    if (closed) return;
    const recovered = recoverTree();
    // The RPC can read a different state while this first check is pending.
    const moved = wasRunning !== running;
    wasRunning = running;
    processPoll = clock.setTimeout(pollGame, GAME_POLL_MS);
    // A save already queued will read the game state along with the records.
    if ((moved || recovered) && debounce === undefined) changed();
  }

  bindTree();
  void pollGame();
  return () => {
    closed = true;
    closeWatchers();
    if (debounce !== undefined) clock.clearTimeout(debounce);
    if (processPoll !== undefined) clock.clearTimeout(processPoll);
  };
}

import { engine } from "./engineLink";
import type { Rpc } from "./services/envelope";
import { pluginToast, toastError } from "./toast";
import { autoUpdateText, shouldAutoCheck, updateSummaryText } from "./steamLibrary";
import { settingsStore } from "./settings";
import { createStore } from "./store";

/**
 * The addon-update summary shown on Steam's own pages (BEYOND-05): the
 * linked game's page band and its home-tile badge read the same store, so
 * one check updates both. Module scope: both render while our QAM is closed.
 */
export type Summary = { installationId: string; displayName: string; updates: number }[];

export interface SteamUpdatesState {
  summary: Summary | null;
  checking: boolean;
  /** When the last check this session finished; null before one (the game-page box's "Checked …"). */
  checkedAt: number | null;
}

export interface SteamUpdatesDeps {
  rpc: Rpc;
  toast: (title: string, body?: string) => void;
  toastError: (title: string, error: unknown) => void;
  /** The steamAutoCheck option, read when a surface appears. */
  autoCheckOn: () => boolean;
  now: () => number;
}

export interface SteamUpdates {
  get(): SteamUpdatesState;
  subscribe(listener: () => void): () => void;
  /** The last known counts, no network (cheap; for when the page or tile appears). */
  loadSummary(): Promise<void>;
  /** Ask the providers for every installation; one check at a time. */
  checkNow(opts: { toast: boolean }): Promise<void>;
  /**
   * What the band and the badge call when they appear: show the last known
   * counts at once, and check in the background when the option is on and the
   * last check is older than 15 minutes (shouldAutoCheck; owner, 2026-10-16). Silent:
   * the band and badge themselves show the result.
   */
  onSurfaceShown(): void;
}

export function createSteamUpdates(deps: SteamUpdatesDeps): SteamUpdates {
  const { rpc, toast, toastError } = deps;
  const store = createStore<SteamUpdatesState>({
    summary: null,
    checking: false,
    checkedAt: null,
  });
  let lastCheckAt = 0;
  let inFlight: Promise<void> | null = null;
  const patch = store.patch;

  async function loadSummary(): Promise<void> {
    try {
      patch({ summary: (await rpc("addons.updateSummary", { refresh: false })).installations });
    } catch {
      // Keep what is shown.
    }
  }

  function checkNow(opts: { toast: boolean }): Promise<void> {
    if (inFlight) {
      return inFlight;
    }
    lastCheckAt = deps.now();
    patch({ checking: true });
    inFlight = (async () => {
      try {
        const { installations } = await rpc("addons.updateSummary", {
          refresh: true,
          manual: opts.toast,
        });
        patch({ summary: installations, checkedAt: deps.now() });
        if (opts.toast) {
          toast("Checked for addon updates", updateSummaryText(installations));
        }
      } catch (e) {
        if (opts.toast) {
          toastError("Couldn't check for updates", e);
        }
      } finally {
        patch({ checking: false });
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    get: store.get,
    subscribe: store.subscribe,
    loadSummary,
    checkNow,
    onSurfaceShown() {
      void loadSummary();
      if (shouldAutoCheck(deps.autoCheckOn(), lastCheckAt, deps.now())) {
        void checkNow({ toast: false });
      }
    },
  };
}

/** The one Steam-pages update summary, wired to the engine. */
export const steamUpdates = createSteamUpdates({
  rpc: engine.rpc,
  toast: pluginToast,
  toastError,
  autoCheckOn: () => settingsStore.get().settings.steamAutoCheck,
  now: () => Date.now(),
});

// An automatic update runs in the engine while nothing of ours may be open
// (WF-02): say what it did, and refresh the Steam band and badge.
engine.events.on("addons.autoUpdated", ({ result }) => {
  const text = autoUpdateText(result);
  if (text) {
    pluginToast(text.title, text.body);
  }
  void steamUpdates.loadSummary();
});

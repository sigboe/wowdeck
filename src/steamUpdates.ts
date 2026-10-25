import * as api from "./services/backend";
import { pluginToast, toastError } from "./toast";
import { shouldAutoCheck, updateSummaryText } from "./steamLibrary";
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
}

const store = createStore<SteamUpdatesState>({ summary: null, checking: false });
let lastCheckAt = 0;
let inFlight: Promise<void> | null = null;

export const getSteamUpdates = store.get;
export const subscribeSteamUpdates = store.subscribe;
const patch = store.patch;

/** The last known counts, no network (cheap; for when the page or tile appears). */
export async function loadSummary(): Promise<void> {
  try {
    patch({ summary: (await api.rpc("addons.updateSummary", { refresh: false })).installations });
  } catch {
    // Keep what is shown.
  }
}

/** Ask the providers for every installation; one check at a time. */
export function checkNow(opts: { toast: boolean }): Promise<void> {
  if (inFlight) {
    return inFlight;
  }
  lastCheckAt = Date.now();
  patch({ checking: true });
  inFlight = (async () => {
    try {
      const { installations } = await api.rpc("addons.updateSummary", { refresh: true });
      patch({ summary: installations });
      if (opts.toast) {
        pluginToast("Checked for addon updates", updateSummaryText(installations));
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

/**
 * What the band and the badge call when they appear: show the last known
 * counts at once, and check in the background when the option is on and the
 * last check is older than 15 minutes (shouldAutoCheck; owner, 2026-10-16). Silent:
 * the band and badge themselves show the result.
 */
export function onSteamSurfaceShown(): void {
  void loadSummary();
  if (shouldAutoCheck(settingsStore.get().settings.steamAutoCheck, lastCheckAt, Date.now())) {
    void checkNow({ toast: false });
  }
}

/** After Update all: the counts changed. */
export function afterUpdate(): Promise<void> {
  return loadSummary();
}

/**
 * WoWDeck's own update state (the plugin, not addons), kept at module scope:
 * one engine-backed answer shared by everything that shows it — the load/wake
 * toast trigger and Options → Updates — instead of each fetching its own.
 * Module scope also survives Decky's modal round-trips (guide G4: any modal
 * unmounts the panel), so an in-flight check or a mid-staging Update button
 * is not lost to opening a dropdown or the guide.
 */

import type { Store } from "./store";
import { createStore } from "./store";
import type { rpcVia } from "./services/envelope";
import {
  pluginUpdateToast,
  type PluginUpdateInfo,
  type StagedUpdate,
  type UpdateRequestResult,
} from "./pluginUpdate";

export interface SelfUpdateState {
  /** The engine's last update-check answer; null until one arrives. */
  info: PluginUpdateInfo | null;
  /** Stage-and-hand-off (the Update button's job) is running. */
  staging: boolean;
}

export interface SelfUpdateDeps {
  rpc: ReturnType<typeof rpcVia>;
  toast(title: string, body?: string): void;
  toastError(title: string, e: unknown): void;
  /** Hand a staged update to Decky's own installer (pluginUpdate's adapter). */
  requestUpdate(staged: StagedUpdate): Promise<UpdateRequestResult>;
  /** The clock, injected so freshness tests stay deterministic. */
  now?(): number;
}

export interface SelfUpdateStore extends Pick<Store<SelfUpdateState>, "get" | "subscribe"> {
  /**
   * What every surface trigger calls (plugin load, wake from suspend,
   * opening Options): re-ask the engine unless the held answer is fresh,
   * sharing one in-flight fetch with concurrent callers. Only a toast
   * caller asks the engine with `notify` (the one ask that may report the
   * version's toast); one that arrives during a quiet ask asks again with
   * notify once it lands, which the engine answers from its stored answer. The
   * time-passing triggers (load, wake) pass `force`: they are rare and
   * say time may have moved, so they ask even inside the window and let
   * the engine's own cadence decide whether it costs a request.
   */
  refresh(opts?: { toast?: boolean; force?: boolean }): Promise<void>;
  /**
   * Stage the new release in the engine (download + verify), then hand it
   * to Decky's own installer: the loader's native prompt installs from the
   * local file and reloads the plugin. Declining the prompt changes
   * nothing; the button stays usable.
   */
  runUpdate(): Promise<void>;
}

/**
 * How long a held answer stays fresh on this side: the engine's own cadence
 * (a daily cap, plus a 1h/2h/4h failure backoff) decides whether an ask
 * costs a request — this only keeps the surface triggers (which fire often:
 * every Options visit) from re-asking within one sitting. Only an answer
 * that could check holds: a failed ask or an "unknown" answer leaves the
 * next trigger free to ask (the engine's backoff decides whether that costs
 * a request).
 */
export const ANSWER_FRESH_MS = 15 * 60 * 1000;

export function createSelfUpdateStore(deps: SelfUpdateDeps): SelfUpdateStore {
  const store = createStore<SelfUpdateState>({ info: null, staging: false });
  const { rpc, toast, toastError, requestUpdate } = deps;
  const now = deps.now ?? Date.now;
  /** When the engine last answered with a checked status; 0 until then. */
  let answeredAt = 0;
  let inFlight: Promise<void> | null = null;
  /** Whether the in-flight ask carries notify (may report the toast). */
  let inFlightNotify = false;

  /** One engine ask; concurrent callers share it. Never rejects. */
  const check = (notify: boolean): Promise<void> => {
    if (inFlight) {
      return notify && !inFlightNotify ? inFlight.then(() => check(true)) : inFlight;
    }
    inFlightNotify = notify;
    inFlight = (async () => {
      try {
        const answer = await rpc("system.updateCheck", notify ? { notify: true } : {});
        answeredAt = answer.status === "unknown" ? 0 : now();
        store.patch({ info: answer });
        const t = notify ? pluginUpdateToast(answer) : null;
        if (t) {
          toast(t.title, t.body);
        }
      } catch {
        // Engine not ready: keep what is shown; the next trigger re-asks.
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  };

  return {
    get: store.get,
    subscribe: store.subscribe,
    refresh(opts = {}) {
      if (!opts.force && now() - answeredAt < ANSWER_FRESH_MS) {
        return Promise.resolve();
      }
      return check(opts.toast === true);
    },
    async runUpdate() {
      if (store.get().staging) {
        return;
      }
      store.patch({ staging: true });
      try {
        const outcome = await rpc("system.updateStage");
        if (!outcome.result) {
          toast("Couldn't update WoWDeck", outcome.error?.message ?? "Try again later");
          return;
        }
        const requested = await requestUpdate(outcome.result);
        if (!requested.success) {
          toast("Couldn't update WoWDeck", requested.error ?? "Try again later");
        }
      } catch (e) {
        toastError("Couldn't update WoWDeck", e);
      } finally {
        store.patch({ staging: false });
      }
    },
  };
}

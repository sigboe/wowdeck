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
import type { UpdateChannel } from "./types";
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
  /** A Check again is running: the panel's button and the Updates row say "Checking…". */
  checking: boolean;
}

/** How a Check again ended; each has its own toast. */
export type CheckAgainResult =
  { kind: "current" } | { kind: "available"; version: string } | { kind: "failed" };

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
   * time-passing triggers (load, wake) pass `bypassWindow`: they are rare and
   * say time may have moved, so they ask even inside the window and let
   * the engine's own cadence decide whether it costs a request.
   */
  refresh(opts?: { toast?: boolean; bypassWindow?: boolean }): Promise<void>;
  /**
   * Stage the new release in the engine (download + verify), then hand it
   * to Decky's own installer: the loader's native prompt installs from the
   * local file and reloads the plugin. Declining the prompt changes
   * nothing; the button stays usable. Either way the run ends by re-reading
   * the engine's answer, past the freshness window: staging may have forced
   * a fresh check (the offered zip was gone), and the engine serves that
   * stored answer without another request.
   */
  runUpdate(): Promise<void>;
  /**
   * Switch the update channel (the "WoWDeck Update Channel" modal): the
   * engine stores it and checks the new channel at once, and its answer
   * replaces what the panel, the dot and the Updates row show. A check
   * already in flight lands first, so it cannot overwrite the new
   * channel's answer. A failure toasts and keeps what is shown. Resolves
   * to whether the channel was stored.
   */
  setChannel(channel: UpdateChannel): Promise<boolean>;
  /**
   * The update channel the engine has stored, for the modal's checkmark. A
   * failure toasts and resolves null.
   */
  getChannel(): Promise<UpdateChannel | null>;
  /**
   * Check again (X on the panel's Update button and on the Updates row):
   * ask the engine with `force`, past this side's freshness window and the
   * engine's daily cap and failure backoff. Its answer replaces what every
   * surface shows, and a toast says how it ended. A press while one runs
   * joins it (one ask, one toast); a press during a trigger's unforced ask
   * waits it out, then forces its own.
   */
  checkAgain(): Promise<CheckAgainResult>;
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
  const store = createStore<SelfUpdateState>({ info: null, staging: false, checking: false });
  const { rpc, toast, toastError, requestUpdate } = deps;
  const now = deps.now ?? Date.now;
  /** When the engine last answered with a checked status; 0 until then. */
  let answeredAt = 0;
  /** The ask in flight; it resolves to the engine's answer, or null when the ask failed. */
  let inFlight: Promise<PluginUpdateInfo | null> | null = null;
  /** Whether the in-flight ask carries notify (may report the toast). */
  let inFlightNotify = false;
  /** Whether the in-flight ask carries force (Check again). */
  let inFlightForce = false;
  /**
   * The Check again in progress; a second press joins it. The engine's
   * forced check waits out a pending run instead of joining it
   * (PluginUpdateCheck.check, SingleFlight.runAfterPending), so this flight
   * is what keeps a double press to one request and one toast.
   */
  let checkAgainFlight: Promise<CheckAgainResult> | null = null;

  /** Show an engine answer; only one that could check counts as fresh. */
  const land = (answer: PluginUpdateInfo) => {
    answeredAt = answer.status === "unknown" ? 0 : now();
    store.patch({ info: answer });
  };

  /**
   * One engine ask; concurrent callers share it. A caller that needs what
   * the ask in flight lacks (notify, force) asks again once it lands.
   * Never rejects: a failed ask resolves null.
   */
  const check = (notify: boolean, force = false): Promise<PluginUpdateInfo | null> => {
    if (inFlight) {
      const joinable = (!notify || inFlightNotify) && (!force || inFlightForce);
      return joinable ? inFlight : inFlight.then(() => check(notify, force));
    }
    inFlightNotify = notify;
    inFlightForce = force;
    inFlight = (async () => {
      try {
        const answer = await rpc("system.updateCheck", {
          ...(notify && { notify: true }),
          ...(force && { force: true }),
        });
        land(answer);
        const t = notify ? pluginUpdateToast(answer) : null;
        if (t) {
          toast(t.title, t.body);
        }
        return answer;
      } catch {
        // Engine not ready: keep what is shown; the next trigger re-asks.
        return null;
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
      if (!opts.bypassWindow && now() - answeredAt < ANSWER_FRESH_MS) {
        return Promise.resolve();
      }
      return check(opts.toast === true).then(() => undefined);
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
        // A check in flight since before staging may land the stale answer;
        // let it, then ask again.
        await inFlight;
        await check(false);
      }
    },
    async setChannel(channel) {
      await inFlight;
      try {
        const answer = await rpc("system.setUpdateChannel", { channel });
        land(answer);
        return true;
      } catch (e) {
        toastError("Couldn't switch the update channel", e);
        return false;
      }
    },
    checkAgain() {
      if (checkAgainFlight) {
        return checkAgainFlight;
      }
      store.patch({ checking: true });
      checkAgainFlight = (async () => {
        const result = checkAgainResult(await check(false, true));
        toast(checkAgainToast(result));
        return result;
      })().finally(() => {
        checkAgainFlight = null;
        store.patch({ checking: false });
      });
      return checkAgainFlight;
    },
    async getChannel() {
      try {
        return (await rpc("system.getUpdateChannel")).channel;
      } catch (e) {
        toastError("Couldn't read the update channel", e);
        return null;
      }
    },
  };
}

/** A forced answer's outcome: anything but a fresh, known answer failed. */
function checkAgainResult(answer: PluginUpdateInfo | null): CheckAgainResult {
  if (answer === null || answer.failed || answer.status === "unknown") {
    return { kind: "failed" };
  }
  return answer.offer ? { kind: "available", version: answer.offer.version } : { kind: "current" };
}

function checkAgainToast(result: CheckAgainResult): string {
  switch (result.kind) {
    case "current":
      return "WoWDeck is up to date";
    case "available":
      return `WoWDeck ${result.version} is available`;
    case "failed":
      return "Couldn't check for updates";
  }
}

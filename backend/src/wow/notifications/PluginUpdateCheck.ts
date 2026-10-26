/**
 * Whether a newer WoWDeck release exists on GitHub — for the plugin
 * itself, not addons: the plugin is not in the official Decky store, so
 * nothing else tells the user an update exists. The check surfaces the
 * release page and the packaged zip; staging that zip for Decky's own
 * installer is system.updateStage's job (UpdateStager).
 *
 * Asks the channel's build source **at most once a day**, following the
 * same cadence rule as the addon check behind the SteamOS toast
 * (CheckCadence, own timestamp and interval): an engine session on a Deck
 * that sleeps can last weeks, so "once per session" would mean "possibly
 * never". The answer and the time it ran are persisted, which also lets a
 * restart inside the interval answer without a call — and lets the status be
 * recomputed against the running version, so a plugin that was just updated
 * reads "current" immediately instead of waiting out the day.
 *
 * The interval only advances on an answer. A failed check (offline, HTTP
 * 404, rate limited, a rejected token) is not a timestamp: it never
 * advances the daily stamp, and — since the check runs on natural triggers
 * only (plugin load, opening Options → Updates, waking the Deck) — the
 * retries back off instead, spaced 1h after the first failure, 2h after
 * the second, 4h after the third and every later one (capped), so an
 * unreachable GitHub is not re-asked by every trigger while still hearing
 * from the Deck several times a day. Any success resets the backoff and
 * re-arms the daily cadence. Failed checks stay completely silent: no
 * toast, no error, one structured stderr line (below).
 *
 * The builds come from the update channel's build source (BuildSource):
 * Stable, GitHub's `releases/latest`, is the only one so far. Of the
 * candidates it returns, the newest is the answer.
 *
 * "unknown", never an error: the repo can be private beyond the token's
 * reach (the API answers 404), the Deck can be offline, GitHub can
 * rate-limit, the configured token can be rejected — none of that may
 * surface as a user-facing failure.
 */

import type { PluginUpdateBackoff, PluginUpdateSnapshot } from "../../api/contracts";
import type { NetworkClient } from "../net/network";
import {
  type BuildSource,
  type CandidateBuild,
  GithubLatestReleaseSource,
  RELEASES_PAGE,
  type UpdateChannel,
} from "../plugin/BuildSource";
import { compareVersions } from "../plugin/PluginVersion";
import { backoffIntervalMs, DAY_MS, HOUR_MS, isDue, SingleFlight } from "./CheckCadence";

export { compareVersions };

export interface PluginUpdateStatus {
  status: "current" | "available" | "unknown";
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  /** The release's WoWDeck.zip asset (what updateStage downloads), on "available" only. */
  downloadUrl: string | null;
  /**
   * True when a network attempt just ran for this answer (even a failed one
   * that fell back to the stored answer); false when the cadence served the
   * stored answer without one. No surface keys on it: it is how the cadence
   * is observable over the RPC (the integration tests), and toastPending
   * decides the toast.
   */
  checked: boolean;
  /**
   * Whether the update toast should fire now: true only for a toast
   * caller's first answer (fresh or cached) that offers a newer release
   * with its WoWDeck.zip, not yet toast-shown. At-most-once per version —
   * see PluginSettings' pluginUpdateToastShownFor.
   */
  toastPending: boolean;
}

/** Where the last answer is persisted: the engine's settings, an object in tests. */
export interface PluginUpdateStore {
  read(): PluginUpdateSnapshot | null;
  write(snapshot: PluginUpdateSnapshot): void;
  /** The failure backoff: consecutive failures and when the last one ran. */
  readBackoff(): PluginUpdateBackoff | null;
  /** Record the n-th consecutive failure, or clear the backoff on a success. */
  writeBackoff(backoff: PluginUpdateBackoff | null): void;
  /** The release version the toast was already shown for, when it was. */
  readToastShown(): string | null;
  /** Marks the version shown — called the moment a check reports it pending. */
  writeToastShown(version: string): void;
}

function memoryStore(): PluginUpdateStore {
  let stamp: PluginUpdateSnapshot | null = null;
  let backoff: PluginUpdateBackoff | null = null;
  let toastShownFor: string | null = null;
  return {
    read: () => stamp,
    write: (snapshot) => {
      stamp = snapshot;
    },
    readBackoff: () => backoff,
    writeBackoff: (value) => {
      backoff = value;
    },
    readToastShown: () => toastShownFor,
    writeToastShown: (version) => {
      toastShownFor = version;
    },
  };
}

export class PluginUpdateCheck {
  #flight = new SingleFlight<Omit<PluginUpdateStatus, "toastPending">>();
  readonly #sources: Record<UpdateChannel, BuildSource>;
  readonly #channel: UpdateChannel = "stable";

  constructor(
    net: Pick<NetworkClient, "getJson">,
    private currentVersion: string,
    /** Overridable like HUB_URL, so the integration test points it at its mock. */
    releasesUrl = "https://api.github.com/repos/sigboe/wowdeck/releases/latest",
    /** The addon source's optional GitHub token, reused when it can read this repo. */
    tokenProvider: () => string | undefined = () => undefined,
    /** The persisted answer and timestamp: this is the once-a-day cap. */
    private store: PluginUpdateStore = memoryStore(),
    private now: () => number = Date.now,
  ) {
    this.#sources = { stable: new GithubLatestReleaseSource(net, releasesUrl, tokenProvider) };
  }

  /**
   * The stored answer when the last check is inside the interval, otherwise
   * one network check (concurrent callers share it). Never throws.
   *
   * Only a toast trigger (plugin load, wake — `notify`) may report and spend
   * the version's toast; Options' refresh and system.updateStage show the
   * panel instead, so they must not use it up. The gate runs per caller,
   * after the shared run, so a toast caller joining a quiet one still gets it.
   */
  async check(opts: { notify?: boolean } = {}): Promise<PluginUpdateStatus> {
    const answer = await this.#flight.run(() => this.#run());
    return opts.notify ? this.#toastGate(answer) : { ...answer, toastPending: false };
  }

  async #run(): Promise<Omit<PluginUpdateStatus, "toastPending">> {
    const stamp = this.store.read();
    const now = this.now();
    if (!isDue(stamp?.checkedAt ?? null, now, this.#interval(stamp))) {
      return this.#fromStamp(stamp!);
    }
    // The day's check is due, but failures back off: within the window the
    // stored answer serves — no request, `checked` false — exactly like the
    // daily cap's cached answer, so a Deck that cannot reach GitHub is not
    // re-asked by every trigger (plugin load, wake, Options visit).
    const backoff = this.store.readBackoff();
    if (backoff !== null && !isDue(backoff.failedAt, now, backoffIntervalMs(backoff.failures))) {
      return stamp !== null ? this.#fromStamp(stamp) : this.#unknown(false);
    }
    const fresh = await this.#fetch();
    if (fresh !== null) {
      const snapshot = { ...fresh, checkedAt: this.now() };
      this.store.write(snapshot);
      // A success re-arms the plain daily cadence.
      this.store.writeBackoff(null);
      return { ...this.#fromStamp(snapshot), checked: true };
    }
    const failures = (backoff?.failures ?? 0) + 1;
    this.store.writeBackoff({ failedAt: this.now(), failures });
    // A failure keeps serving the stored answer, as inside the backoff
    // window: otherwise the panel would vanish on the failed attempt and
    // come back on the next trigger.
    return stamp !== null ? { ...this.#fromStamp(stamp), checked: true } : this.#unknown(true);
  }

  /**
   * How long the stored answer holds: a day, except an available release
   * whose WoWDeck.zip was not attached yet (CI uploads it after creating the
   * release) — that one is re-asked hourly, so Update does not wait a day.
   */
  #interval(stamp: PluginUpdateSnapshot | null): number {
    if (stamp === null) return DAY_MS;
    const answer = this.#fromStamp(stamp);
    return answer.status === "available" && answer.downloadUrl === null ? HOUR_MS : DAY_MS;
  }

  /**
   * The once-per-release-version toast gate. True only when this answer
   * offers a newer release, with its WoWDeck.zip (the toast says "Update in
   * Options"; without the zip there is no Update), the toast was not yet
   * shown for — and the moment
   * that is reported, the version is marked shown, so no later re-check
   * (cached inside the day, fresh the next day, a restarted engine) can
   * ever re-toast it. A genuinely newer version is a new key and earns its
   * own single toast. Everything else — "current", "unknown" — never toasts.
   *
   * At-most-once by design: marking happens when pending is *reported*, so
   * a caller that drops the answer spends the toast — one lost toast beats
   * a nagging one.
   */
  #toastGate(result: Omit<PluginUpdateStatus, "toastPending">): PluginUpdateStatus {
    const candidate = result.status === "available" && result.downloadUrl !== null ? result.latestVersion : null;
    if (candidate === null) {
      return { ...result, toastPending: false };
    }
    const pending = this.store.readToastShown() !== candidate;
    if (pending) {
      this.store.writeToastShown(candidate);
    }
    return { ...result, toastPending: pending };
  }

  /** The stored answer, compared against the version running right now. */
  #fromStamp(stamp: PluginUpdateSnapshot): Omit<PluginUpdateStatus, "toastPending"> {
    const cmp = compareVersions(stamp.latestVersion, this.currentVersion);
    if (cmp === null) {
      return this.#unknown(false);
    }
    return {
      status: cmp > 0 ? "available" : "current",
      currentVersion: this.currentVersion,
      latestVersion: stamp.latestVersion,
      releaseUrl: stamp.releaseUrl ?? RELEASES_PAGE,
      downloadUrl: cmp > 0 ? stamp.downloadUrl : null,
      checked: false,
    };
  }

  #unknown(checked: boolean): Omit<PluginUpdateStatus, "toastPending"> {
    return {
      status: "unknown",
      currentVersion: this.currentVersion,
      latestVersion: null,
      releaseUrl: null,
      downloadUrl: null,
      checked,
    };
  }

  /**
   * One ask of the channel's build source: its newest candidate as a
   * snapshot to store (checkedAt still unset), or null when the check could
   * not run or found no build with a parseable version.
   */
  async #fetch(): Promise<PluginUpdateSnapshot | null> {
    const builds = await this.#sources[this.#channel].candidates();
    let newest: CandidateBuild | null = null;
    for (const build of builds ?? []) {
      // Sources only return parseable versions, so the comparison never
      // answers "can't tell" here.
      if (newest === null || (compareVersions(build.version, newest.version) ?? 0) > 0) newest = build;
    }
    if (newest === null || compareVersions(newest.version, this.currentVersion) === null) return null;
    // The zip is stored whatever the running version: a same-day rollback
    // below this release then still finds it (#fromStamp exposes it only
    // while the release is newer).
    return {
      checkedAt: 0,
      latestVersion: newest.version,
      releaseUrl: newest.releaseUrl,
      downloadUrl: newest.downloadUrl,
      ...(newest.releaseNotes !== null && { releaseNotes: newest.releaseNotes }),
    };
  }
}

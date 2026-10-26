/**
 * The cadence rule shared by the plugin's periodic checks: the addon update
 * check behind the SteamOS toast (UpdateToastGate) and WoWDeck's own release
 * check (PluginUpdateCheck).
 *
 * Each check keeps **its own** persisted timestamp and interval — they are
 * independent features, and one must never silence the other — but they share
 * the rule ("is this check due?") and the concurrency guard ("callers that
 * arrive mid-check join the run already in flight").
 *
 * Deliberately small and dependency-free: arithmetic plus one promise, so it
 * is testable without a clock, a store or a network, and so a future third
 * check reuses the behaviour instead of re-inventing it.
 */

/** 24 hours in ms: the interval both checks start from. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/** One hour in ms: the first step of the failure-backoff ladder. */
export const HOUR_MS = 60 * 60 * 1000;

/** The longest the failure backoff ever grows: four hours (capped). */
const BACKOFF_CAP_MS = 4 * HOUR_MS;

/**
 * How long the n-th *consecutive* failed check must wait before the next
 * network attempt: one hour after the first failure, two after the second,
 * four after the third and every later one — capped, so a Deck that never
 * reaches GitHub still re-tries several times a day instead of hammering
 * every trigger (plugin load, wake, opening Options). Zero failures means
 * no spacing. Any success clears the count and restores the daily cadence.
 */
export function backoffIntervalMs(consecutiveFailures: number): number {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures < 1) {
    return 0;
  }
  return Math.min(2 ** (consecutiveFailures - 1) * HOUR_MS, BACKOFF_CAP_MS);
}

/**
 * Whether a check that last completed at `lastAt` is due again at `now`:
 * it has never run, its stamp is unusable, or at least `intervalMs` has
 * passed. A stamp in the future (the clock moved, the state came from
 * another device) counts as due — running once more is harmless, while
 * trusting it could silence the check for the whole interval.
 */
export function isDue(lastAt: number | null | undefined, now: number, intervalMs: number): boolean {
  if (lastAt === null || lastAt === undefined || !Number.isFinite(lastAt)) {
    return true;
  }
  const age = now - lastAt;
  return age < 0 || age >= intervalMs;
}

/**
 * Collapses concurrent callers onto one in-flight run: a second caller that
 * arrives while the check is running gets the same promise instead of
 * starting a duplicate network call. Once it settles, the next caller starts
 * a new run (subject to its own due check).
 */
export class SingleFlight<T> {
  #pending: Promise<T> | null = null;

  run(start: () => Promise<T>): Promise<T> {
    if (this.#pending === null) {
      this.#pending = start().finally(() => {
        this.#pending = null;
      });
    }
    return this.#pending;
  }
}

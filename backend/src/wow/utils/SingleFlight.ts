/**
 * The engine's one single-flight guard: callers that arrive while a run is
 * in flight join it instead of starting a duplicate. The addon updates
 * module, the update toast, WoWDeck's own release check and the About
 * page's fetched files all use it.
 */

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

  /**
   * A run of its own, never joined to the one in flight: waits that one out
   * first. For a caller whose inputs changed since the pending run started
   * (an update channel switch).
   */
  async runAfterPending(start: () => Promise<T>): Promise<T> {
    // Re-checked after every wait: another caller may have started a run
    // while this one waited. The check and run() share a synchronous step.
    while (this.#pending !== null) {
      await this.#pending.catch(() => undefined);
    }
    return this.run(start);
  }
}

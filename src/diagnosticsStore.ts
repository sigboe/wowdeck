import { createStore, type Store } from "./store";
import { engine } from "./engineLink";
import type { Rpc } from "./services/envelope";
import type { Diagnostics } from "./types";

export interface DiagnosticsStore extends Pick<
  Store<{ diagnostics: Diagnostics | null }>,
  "get" | "subscribe" | "set"
> {
  /** Read the diagnostics again; a failure keeps the last answer (engine not ready). */
  load(): Promise<void>;
}

export function createDiagnosticsStore(deps: { rpc: Rpc }): DiagnosticsStore {
  const store = createStore<{ diagnostics: Diagnostics | null }>({ diagnostics: null });
  return {
    get: store.get,
    subscribe: store.subscribe,
    set: store.set,
    async load() {
      try {
        store.set({ diagnostics: await deps.rpc("system.diagnostics") });
      } catch {
        // engine not ready
      }
    },
  };
}

/**
 * The last `system.diagnostics` answer, at module scope: installing WowUp
 * Companion from Options opens a modal, which unmounts the panel (guide G4),
 * and the status read after the install must reach the remounted Options.
 */
export const diagnosticsStore = createDiagnosticsStore({ rpc: engine.rpc });

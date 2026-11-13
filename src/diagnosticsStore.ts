import { createStore } from "./store";
import type { Rpc } from "./services/envelope";
import type { Diagnostics } from "./types";

/**
 * The last `system.diagnostics` answer, at module scope: installing WowUp
 * Companion from Options opens a modal, which unmounts the panel (guide G4),
 * and the status read after the install must reach the remounted Options.
 */
export const diagnosticsStore = createStore<{ diagnostics: Diagnostics | null }>({
  diagnostics: null,
});

/** Read the diagnostics again; a failure keeps the last answer (engine not ready). */
export async function loadDiagnostics(rpc: Rpc): Promise<void> {
  try {
    diagnosticsStore.set({ diagnostics: await rpc("system.diagnostics") });
  } catch {
    // engine not ready
  }
}

/**
 * Pure UI-decision logic for the CurseForge source row and its key modal,
 * pulled out of the components so it's unit-testable without @decky/ui —
 * mirrors the pattern already established for diagnosticsText
 * (src/diagnostics.ts) and nextSelectableId (src/shoulderNav.ts).
 */

import type { CurseForgeAuthStatus, ProviderInfo } from "./types";

/**
 * What the CurseForge row in Addon sources offers:
 * - `keyRow`: a `>` row that opens the key modal (no usable key);
 * - `ownKeyToggle`: the source toggle, its Options button (≡) "API key"
 *   opening the same modal (the player's own key is the one in use);
 * - `toggle`: a plain toggle (built-in access works).
 *
 * "Usable" is the engine's `configured` rule: some key is not known to be
 * rejected. Built-in access that is unchecked or briefly failing still counts.
 */
export type CurseForgeRowState = "keyRow" | "ownKeyToggle" | "toggle";

export function curseForgeRowState(
  provider: ProviderInfo,
  auth: CurseForgeAuthStatus | null,
): CurseForgeRowState {
  if (!provider.configured) {
    return "keyRow";
  }
  return auth?.activeSource === "user" ? "ownKeyToggle" : "toggle";
}

/** Reports whether the stored user key is usable, invalid, or not yet verified — never the key value itself. */
export function userKeyStatusLabel(status: CurseForgeAuthStatus): string {
  if (!status.userConfigured) {
    return "No CurseForge key saved yet";
  }
  switch (status.userStatus) {
    case "valid":
      return "Your key works";
    case "invalid":
      return "CurseForge rejected your saved key. Enter a different one below.";
    case "unknown":
      return "Your saved key couldn't be checked just now. It's still being used.";
    case "unvalidated":
      return "Your key is saved. It's checked the next time it's used.";
  }
}

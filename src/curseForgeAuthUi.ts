/**
 * Pure UI-decision logic for the Options CurseForge section, pulled out
 * of SettingsView.tsx so it's unit-testable without @decky/ui — mirrors
 * the pattern already established for diagnosticsText
 * (src/diagnostics.ts) and nextSelectableId (src/shoulderNav.ts).
 */

import type { CurseForgeAuthStatus } from "./types";

/**
 * Visibility rule: the CurseForge section (and the Providers list's
 * "Using your API key" line) is shown unless the bundled key is both
 * present and confirmed valid by an actual check. Anything short of a
 * confirmed `valid` — absent, confirmed `invalid`, merely `unvalidated`
 * (hasn't been checked yet this session), or `unknown` (a transient
 * network/rate-limit/server hiccup) — keeps the section visible, since
 * none of those states are a proven-working bundled key.
 */
export function shouldShowCurseForgeKeySection(status: CurseForgeAuthStatus): boolean {
  return !(status.bundledPresent && status.bundledStatus === "valid");
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

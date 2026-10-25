/**
 * The Options jump (ADR 0002): navigation to Options' Addon sources section
 * carrying a marked provider-id set — the mechanism the zero-capability
 * screen's button relies on (ZeroCapabilityScreen). The marked rows
 * blink-highlight; first focus lands on the first marked row that can take
 * focus (firstFocusableMarkedSource, sourceAccess.ts), or the caller's
 * fallback row when none can. The jump only navigates and draws attention: it
 * never enables or disables anything (spec story 18) — no engine call happens
 * here, and the only provider state read is the caller's own list.
 *
 * Module scope on purpose (guide G4/P6): the jump is set before the plugin
 * tab switches, and the panel is rebuilt on the way to the sources section.
 *
 * The highlight is transient. It clears on use (the section's toggles call
 * clearSourceJump), when focus moves on to any settings row that is neither
 * marked nor the landing row (observed through focus memory, which every
 * settings row reports to), and when the section leaves (its unmount
 * clears), so a modal round-trip or tab change ends it too.
 */

import { rememberFocus, subscribeFocusMemory } from "./focusMemory";
import { QAM_VIEW } from "./qamState";
import { firstFocusableMarkedSource } from "./sourceAccess";
import type { ProviderInfo } from "./types";

const ROW_KEY_PREFIX = "provider:";

/** The sources section's focus-memory key for a provider's row. */
export const sourceRowKey = (providerId: string): string => `${ROW_KEY_PREFIX}${providerId}`;

/** One jump's arrival state: the marked provider ids, and where focus lands. */
export interface SourceJump {
  readonly marked: ReadonlySet<string>;
  readonly landingKey: string;
  /** When the jump started (ms): rows that mount later join the same blink phase. */
  readonly startedAt: number;
}

const state: { jump: SourceJump | null } = { jump: null };

type JumpListener = () => void;
const listeners = new Set<JumpListener>();

function set(jump: SourceJump | null): void {
  state.jump = jump;
  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * Jump to Options carrying `marked`: their rows in the sources section
 * blink-highlight, and focus lands on the first of them that can take focus,
 * or `fallbackKey` when none can (the CurseForge key row for "Set up
 * CurseForge", whose own toggle is disabled until that key exists). Landing
 * goes through the same focus-memory restore every Options visit uses — the
 * row is remembered before the tab switch, the remounting panel replays it,
 * and a row whose section has not loaded yet (providers, the CurseForge key
 * status) is focused when it registers (focusMemory.ts). Nothing else is
 * touched.
 */
export function startSourceJump(
  marked: readonly string[],
  providers: readonly ProviderInfo[],
  fallbackKey?: string,
): void {
  const ids = new Set(marked);
  const first = firstFocusableMarkedSource(providers, ids);
  const landingKey = first
    ? sourceRowKey(first.id)
    : (fallbackKey ?? (marked[0] ? sourceRowKey(marked[0]) : undefined));
  if (!landingKey) {
    // Nothing to land on and nothing to mark: not a jump.
    return;
  }
  set({ marked: ids, landingKey, startedAt: Date.now() });
  rememberFocus(QAM_VIEW.settings, landingKey);
}

/** The active jump, or null when no highlight is showing. */
export function sourceJump(): SourceJump | null {
  return state.jump;
}

/** Subscribe to the jump starting or clearing; returns the unsubscribe. */
export function subscribeSourceJump(listener: JumpListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** End the highlight (a marked row was used, or the section is leaving). */
export function clearSourceJump(): void {
  if (state.jump) {
    set(null);
  }
}

// Focus moving on ends the highlight: every settings row reports to focus
// memory when it gains focus, so a key that is neither a marked row nor the
// landing row means the user moved on — wherever in Options they went. The
// landing row itself keeps the highlight, and so does any other marked row.
subscribeFocusMemory((view, key) => {
  const jump = state.jump;
  if (!jump || view !== QAM_VIEW.settings) {
    return;
  }
  const onMarkedRow =
    key.startsWith(ROW_KEY_PREFIX) && jump.marked.has(key.slice(ROW_KEY_PREFIX.length));
  if (!onMarkedRow && key !== jump.landingKey) {
    clearSourceJump();
  }
});

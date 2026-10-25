import type { ReactNode } from "react";
import { DialogButton, Focusable, Spinner } from "@decky/ui";
import { FaClock, FaFire, FaSearch } from "react-icons/fa";
import type { ProviderInfo } from "../types";
import {
  zeroCapabilityScreen,
  type SourceCapability,
  type ZeroCapabilityIcon,
  type ZeroCapabilityScreen as ZeroCapabilityScreenState,
} from "../sourceAccess";
import { STEAM } from "../steamTheme";

/**
 * The pane's zero-capability screen (ADR 0002): the one shared panel shown
 * when nothing can serve the destination — Latest and Popular with no
 * discover source in use, Search with nothing that searches by name. The
 * derivation is pure and lives in sourceAccess.ts; this file only maps its
 * glyph and tone to Steam's own empty-state shape the owner accepted for the
 * panel. Its button carries the compatible provider ids to Options (the jump
 * blink-highlights them and focuses the first); nothing is toggled from the
 * pane (story 18).
 */

const ICONS: Record<ZeroCapabilityIcon, ReactNode> = {
  // The destination list's own icons (GetAddonsTab), so the screen reads as
  // that destination's.
  latest: <FaClock />,
  popular: <FaFire />,
  search: <FaSearch />,
};

export function ZeroCapabilityScreen({
  screen,
  onOpenSources,
}: {
  screen: ZeroCapabilityScreenState;
  /** Open Options' sources section, marking these provider ids. */
  onOpenSources: (marked: readonly string[]) => void;
}) {
  const statusColor =
    screen.tone === "error" ? STEAM.danger : screen.tone === "warning" ? STEAM.warning : undefined;
  return (
    <div className="wowdeck-zero-capability">
      <div className="wowdeck-zero-capability-icon">{ICONS[screen.icon]}</div>
      <div className="wowdeck-zero-capability-title">{screen.title}</div>
      <div className="wowdeck-zero-capability-body">{screen.body}</div>
      <Focusable className="wowdeck-zero-capability-action">
        <DialogButton onClick={() => onOpenSources(screen.marked)}>{screen.action}</DialogButton>
      </Focusable>
      <div
        className="wowdeck-zero-capability-status"
        style={statusColor ? { color: statusColor } : undefined}
      >
        {screen.status}
      </div>
    </div>
  );
}

/**
 * A destination wrapped in the capability it needs: a spinner until the
 * sources have loaded, the zero-capability screen when nothing can serve it,
 * the destination's own UI otherwise. There is deliberately no in-between
 * offer: enablement belongs to Options (story 24).
 */
export function CapabilityGate({
  capability,
  providers,
  loaded,
  onOpenSources,
  children,
}: {
  capability: SourceCapability;
  providers: ProviderInfo[];
  /** The sources list has loaded (or failed to): the decision is final. */
  loaded: boolean;
  onOpenSources: (marked: readonly string[]) => void;
  children: ReactNode;
}) {
  if (!loaded) {
    return <Spinner style={{ width: "1.5em", margin: "12px auto", display: "block" }} />;
  }
  const screen = zeroCapabilityScreen(capability, providers);
  return screen ? (
    <ZeroCapabilityScreen screen={screen} onOpenSources={onOpenSources} />
  ) : (
    <>{children}</>
  );
}

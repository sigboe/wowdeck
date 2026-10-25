import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Focusable, GamepadButton, type GamepadEvent } from "@decky/ui";
import { SteamGlyph } from "../steamGlyph";

export interface NavTab {
  id: string;
  label: string;
  icon: ReactNode;
}

interface Props {
  tabs: NavTab[];
  activeId: string;
  onSelect: (id: string) => void;
  /**
   * Widened mode (Get Addons): keep the bar at the collapsed 300 px instead
   * of stretching across the widened panel, so the tab pills and shoulder
   * glyphs stay the size they are when the QAM is collapsed.
   */
  compact?: boolean;
  /** Receives the selected tab, the bar's only focus stop, so a view can put focus on the bar. */
  selectedRef?: RefObject<HTMLDivElement | null>;
}

/**
 * The plugin's tab bar, drawn like Steam's own (Library/Store) tab bar
 * (guide S15): uppercase 12 px bold pills, the selected tab on a 15 % white
 * pill, the focused tab white with dark text, and Steam's own shoulder glyphs
 * at each end (SteamGlyph: LB/RB, L1/R1 ... for the controller in use). The
 * QAM is too narrow for three uppercase labels (measured on a mock with
 * Steam's CSS), so inactive tabs show only their icon. The bumpers themselves
 * are handled by the panel root (index.tsx). Styles: `.wowdeck-tab*` in
 * sharedStyles.ts.
 *
 * Like Valve's bars, the selected tab is the bar's only focus stop (PC-01):
 * moving up into the bar always lands on it, never on a neighbour (which would
 * switch tabs under the user), and Left/Right on it open the neighbouring tab,
 * clamped like L1/R1. Left past the first tab is left to Steam, which moves
 * focus out to the QAM's icon rail. Inactive tabs stay clickable by touch.
 */
export function TopNav({ tabs, activeId, onSelect, compact, selectedRef }: Props) {
  const ownRef = useRef<HTMLDivElement>(null);
  const activeRef = selectedRef ?? ownRef;
  // Set by Left/Right: the newly selected tab mounts as the focus stop and
  // must take focus once Steam has registered it (guide G7).
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) {
      return;
    }
    refocus.current = false;
    const timer = setTimeout(() => activeRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [activeId]);

  const onTabButtonDown = (evt: GamepadEvent) => {
    const button = evt.detail.button;
    if (button !== GamepadButton.DIR_LEFT && button !== GamepadButton.DIR_RIGHT) {
      return;
    }
    const next =
      tabs[tabs.findIndex((t) => t.id === activeId) + (button === GamepadButton.DIR_LEFT ? -1 : 1)];
    if (!next) {
      // Rightmost: nothing beyond. Leftmost: let Steam leave for the icon rail.
      if (button === GamepadButton.DIR_RIGHT) {
        evt.preventDefault();
        evt.stopPropagation();
      }
      return;
    }
    evt.preventDefault();
    evt.stopPropagation();
    refocus.current = true;
    onSelect(next.id);
  };

  return (
    <Focusable
      flow-children="row"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "4px",
        padding: "0 16px 12px",
        // Border-box: `width: auto` already puts the 16 px padding inside the
        // collapsed 300 px, so the capped bar must not add it back.
        ...(compact ? { width: "300px", maxWidth: "100%", boxSizing: "border-box" } : {}),
      }}
    >
      <SteamGlyph button="LeftBumper" fallback="L1" />
      <div style={{ display: "flex", gap: "2px", alignItems: "center" }}>
        {tabs.map((t) => {
          if (t.id !== activeId) {
            return (
              <div key={t.id} className="wowdeck-tab" onClick={() => onSelect(t.id)}>
                {t.icon}
              </div>
            );
          }
          return (
            <Focusable
              key={t.id}
              ref={activeRef}
              className="wowdeck-tab wowdeck-tab-selected"
              onButtonDown={onTabButtonDown}
              // An action is what makes Steam treat a Focusable as a focus
              // target; without one, navigation skipped the bar (PC-01). A on
              // the open tab has nothing to do.
              onActivate={() => {}}
              noFocusRing
            >
              {t.icon}
              <span>{t.label}</span>
            </Focusable>
          );
        })}
      </div>
      <SteamGlyph button="RightBumper" fallback="R1" />
    </Focusable>
  );
}

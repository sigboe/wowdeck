import type { ReactNode } from "react";
import { Focusable, Spinner } from "@decky/ui";

export interface SteamPageBoxButton {
  label: string;
  onActivate: () => void;
  /** Steam's blue; grey otherwise. */
  primary?: boolean;
  /** Shown faded, still a focus stop; A does nothing (no focus to rescue). */
  inert?: boolean;
}

/**
 * A box on Steam's game page in the look of Steam's own feedback box
 * (STEAM_PAGE_BOX_CSS, which the page that renders it injects once): two
 * fixed-height lines of text, an optional bar under them, and buttons on
 * the right. It is always the same height, whatever it shows (#252).
 */
export function SteamPageBox({
  line1,
  line2,
  spinner = false,
  percent = null,
  buttons,
  className,
}: {
  line1: ReactNode;
  line2: ReactNode;
  spinner?: boolean;
  percent?: number | null;
  buttons: SteamPageBoxButton[];
  className?: string;
}) {
  return (
    <Focusable
      flow-children="row"
      className={["wowdeck-page-box", className].filter(Boolean).join(" ")}
    >
      <div className="wowdeck-page-box-text">
        <div className="wowdeck-page-box-line">
          {spinner && <Spinner style={{ width: "16px", height: "16px", flex: "none" }} />}
          <span>{line1}</span>
        </div>
        <div className="wowdeck-page-box-line wowdeck-page-box-detail">
          <span>{line2}</span>
        </div>
        {percent !== null && (
          <div
            className="wowdeck-page-box-track"
            role="progressbar"
            aria-valuenow={Math.floor(percent)}
          >
            <div className="wowdeck-page-box-fill" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      {buttons.map((b, slot) => (
        <Focusable
          // Keyed by place, not label: a button that changes its job keeps
          // its element, so focus stays on it.
          key={slot}
          role="button"
          aria-disabled={b.inert || undefined}
          className={[
            "wowdeck-page-box-button",
            b.primary && "wowdeck-page-box-primary",
            b.inert && "wowdeck-page-box-inert",
          ]
            .filter(Boolean)
            .join(" ")}
          noFocusRing
          // An action is what makes a Focusable a focus stop (TopNav, PC-01):
          // an inert button keeps one that does nothing.
          onActivate={b.inert ? () => {} : b.onActivate}
        >
          {b.label}
        </Focusable>
      ))}
    </Focusable>
  );
}

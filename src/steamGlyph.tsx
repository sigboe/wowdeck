import { Component, createElement, type ComponentType, type ReactNode } from "react";
import { steamLookup } from "./steamLookup";

/**
 * Steam's own controller glyph (guide S15): the component Steam's tab bars
 * draw L1/R1 with. It follows the controller in use (Xbox LB/RB, PlayStation
 * L1/R1, Steam Deck L1/R1, Switch, 8BitDo), which hard-coded text cannot.
 *
 * Neither the glyph nor its button enum is exported by @decky/ui.
 * On webpack, the module exporting the settings hook that names
 * "GamepadUI_KeyboardNavGlyphsDisabled" also exports the glyph and footer
 * legend. The legend renders nothing without a description.
 * On Vite, Steam's tab bars call the same memo component with
 * {bAllowKeyboard, button} for both bumper enum values. That pair identifies
 * the glyph within the settings hook's scope (DEVICE, CDP, 2026-11-22).
 * The button enum has LeftBumper, RightBumper, QuickMenu and HomeMenu keys.
 * A missing or ambiguous lookup falls back to text. See device notes §8.4f.
 */

import { type GlyphButton, findSteamGlyphParts } from "./steamGlyphLookup";

export type { GlyphButton };

let lookup: { components: unknown[]; buttons: Record<GlyphButton, number> | null } | null = null;

function steamGlyphParts() {
  if (lookup) {
    return lookup;
  }
  return (lookup = findSteamGlyphParts(steamLookup));
}

class GlyphBoundary extends Component<{ fallback: ReactNode; children: ReactNode }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** One controller glyph, sized by the surrounding `.wowdeck-glyph` box. */
export function SteamGlyph({ button, fallback }: { button: GlyphButton; fallback: string }) {
  const { components, buttons } = steamGlyphParts();
  const text = <span className="wowdeck-glyph-text">{fallback}</span>;
  const code = buttons?.[button];
  if (components.length === 0 || code === undefined) {
    return <span className="wowdeck-glyph">{text}</span>;
  }
  return (
    <span className="wowdeck-glyph" aria-label={fallback}>
      <GlyphBoundary fallback={text}>
        {components.map((c, i) =>
          createElement(c as ComponentType<{ button: number; bAllowKeyboard: boolean }>, {
            key: i,
            button: code,
            bAllowKeyboard: true,
          }),
        )}
      </GlyphBoundary>
    </span>
  );
}

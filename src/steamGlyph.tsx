import { Component, createElement, type ComponentType, type ReactNode } from "react";
import { findModule, findModuleExport } from "@decky/ui";

/**
 * Steam's own controller glyph (guide S15): the component Steam's tab bars
 * draw L1/R1 with. It follows the controller in use (Xbox LB/RB, PlayStation
 * L1/R1, Steam Deck L1/R1, Switch, 8BitDo), which hard-coded text cannot.
 *
 * Neither the component nor its button enum is exported by @decky/ui, so both
 * are found in Steam's webpack modules (read from the installed client,
 * 2026-10-13 build):
 * - the module that exports the glyph also exports a settings hook whose source
 *   names "GamepadUI_KeyboardNavGlyphsDisabled";
 * - its two component exports are the glyph ({button}) and the footer legend
 *   ({rgButtons, description}); the legend renders nothing without a
 *   description, so rendering both with {button} draws exactly one glyph;
 * - the button enum is the object with LeftBumper/RightBumper/QuickMenu keys.
 * If any lookup fails the fallback text is shown instead. Not yet verified on a Deck.
 */

import {
  type GlyphButton,
  componentExports,
  isGlyphModule,
  isSteamButtonEnum,
} from "./steamGlyphLookup";

export type { GlyphButton };

let lookup: { components: unknown[]; buttons: Record<GlyphButton, number> | null } | null = null;

function steamGlyphParts() {
  if (lookup) {
    return lookup;
  }
  let components: unknown[] = [];
  let buttons: Record<GlyphButton, number> | null = null;
  try {
    const mod = findModule(isGlyphModule) as Record<string, unknown> | undefined;
    components = mod ? componentExports(mod) : [];
    buttons = (findModuleExport(isSteamButtonEnum) as Record<GlyphButton, number>) ?? null;
  } catch {
    // fall back to text
  }
  lookup = { components, buttons };
  return lookup;
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

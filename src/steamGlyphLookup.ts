import type { SteamLookup } from "./steamLookup";

/** Pure parts of the Steam glyph lookup (steamGlyph.tsx), testable without Steam. */

export type GlyphButton = "LeftBumper" | "RightBumper";

const GLYPH_MODULE_MARKER = "GamepadUI_KeyboardNavGlyphsDisabled";

/** The React component exports of a module (memo/observer objects). */
export function componentExports(moduleExports: Record<string, unknown>): unknown[] {
  return Object.values(moduleExports).filter(
    (e) => !!e && typeof e === "object" && "$$typeof" in (e as object),
  );
}

/** True for Steam's controller-button enum (as opposed to other enums). */
export function isSteamButtonEnum(e: unknown): e is Record<GlyphButton, number> {
  if (!e || typeof e !== "object") {
    return false;
  }
  const o = e as Record<string, unknown>;
  return (
    typeof o.LeftBumper === "number" &&
    typeof o.RightBumper === "number" &&
    typeof o.QuickMenu === "number" &&
    typeof o.HomeMenu === "number"
  );
}

function isGlyphSettingsHook(value: unknown): boolean {
  return typeof value === "function" && String(value).includes(GLYPH_MODULE_MARKER);
}

export function isGlyphModule(m: unknown): boolean {
  if (!m || typeof m !== "object") {
    return false;
  }
  try {
    return Object.values(m).some(isGlyphSettingsHook);
  } catch {
    return false;
  }
}

/**
 * The Vite scope includes unrelated React objects. Follow Steam's own tab bar
 * calls, which use the same memo component for both bumper button props.
 */
function findViteGlyph(scope: Record<string, unknown>): unknown {
  const candidates = new Set<unknown>();
  const bumperCall =
    /\.jsx\)\(\s*([\w$]+)\s*,\s*\{\s*bAllowKeyboard\s*:\s*(?:!0|true)\s*,\s*button\s*:\s*([\w$]+)\.(LeftBumper|RightBumper)\b/g;
  for (const value of Object.values(scope)) {
    if (typeof value !== "function") continue;
    const source = String(value);
    if (!source.includes(".LeftBumper") || !source.includes(".RightBumper")) continue;

    const left = new Set<unknown>();
    const right = new Set<unknown>();
    for (const [, binding, enumBinding, side] of source.matchAll(bumperCall)) {
      const component = scope[binding] as { $$typeof?: symbol; type?: unknown } | undefined;
      if (
        !Object.prototype.hasOwnProperty.call(scope, binding) ||
        component?.$$typeof !== Symbol.for("react.memo") ||
        typeof component.type !== "function" ||
        !Object.prototype.hasOwnProperty.call(scope, enumBinding) ||
        !isSteamButtonEnum(scope[enumBinding])
      )
        continue;
      (side === "LeftBumper" ? left : right).add(component);
    }
    for (const component of left) {
      if (right.has(component)) candidates.add(component);
    }
  }
  return candidates.size === 1 ? candidates.values().next().value : undefined;
}

export function findSteamGlyphParts(steam: SteamLookup) {
  let components: unknown[] = [];
  let buttons: Record<GlyphButton, number> | null = null;
  try {
    const exported = steam.findExportedModule(isGlyphModule);
    if (exported) {
      components = componentExports(exported);
    } else {
      const scope = steam.findModuleWith(isGlyphSettingsHook);
      const glyph = scope && findViteGlyph(scope);
      if (glyph) components = [glyph];
    }
    buttons = (steam.findExport(isSteamButtonEnum) as Record<GlyphButton, number>) ?? null;
  } catch {
    // fall back to text
  }
  return { components, buttons };
}

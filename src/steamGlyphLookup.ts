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

export function isGlyphModule(m: unknown): boolean {
  if (!m || typeof m !== "object") {
    return false;
  }
  try {
    return Object.values(m as Record<string, unknown>).some(
      (e) => typeof e === "function" && String(e).includes(GLYPH_MODULE_MARKER),
    );
  } catch {
    return false;
  }
}

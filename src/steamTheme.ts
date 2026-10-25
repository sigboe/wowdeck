/**
 * Steam's own gamepad-UI design tokens, measured from the installed client
 * (SteamOS 3.8.28, Steam client 2026-10-13; guide 5.3). Use these instead of
 * literal colours or `em` font sizes. Re-check with tools/steamui_rules.py after
 * a SteamOS update; the values are Valve's to change.
 */
export const STEAM = {
  /** Row label text. */
  text: "#dcdedf",
  /** Row description and secondary text. */
  textMuted: "#b8bcbf",
  /** Disabled text. */
  textDisabled: "#67707b",
  /** Steam's positive green (context menu "positive", success). */
  positive: "#59bf40",
  /** Steam's primary blue (toggle on, primary button focus). */
  primary: "#1a9fff",
  /** Steam's destructive red as used for text on dark backgrounds. */
  danger: "#ef806c",
  /** Warning text (Steam has no named warning colour; amber chosen to sit beside the above). */
  warning: "#e0b54c",
  /** Row background in dialogs. */
  row: "#23262e",
} as const;

/** Steam's type scale in CSS px (labels 16, descriptions 12). */
export const STEAM_FONT = {
  header: "22px",
  sectionHeader: "18px",
  body: "16px",
  small: "12px",
} as const;

/** Description-style text: Steam's 12/16 px muted line. */
export const descriptionStyle = {
  color: STEAM.textMuted,
  fontSize: STEAM_FONT.small,
  lineHeight: "16px",
} as const;

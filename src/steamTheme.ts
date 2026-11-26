/**
 * Steam's own gamepad-UI design tokens, measured from the installed client
 * (SteamOS 3.8.28, Steam client 2026-10-13; guide 5.3). Use these instead of
 * literal colours or `em` font sizes. Re-check with tools/steamui_rules.py after
 * a SteamOS update; the values are Valve's to change.
 */
export const STEAM = {
  /** Dialog header text (DialogHeader's own colour). */
  header: "#ffffff",
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

/** A result line: green for success, red for failure, secondary text when unknown. */
export const outcomeColor = (ok: boolean | null): string =>
  ok === null ? STEAM.textMuted : ok ? STEAM.positive : STEAM.danger;

/**
 * Decky Loader's own colours, read from its source (decky-loader
 * frontend/src/components/NotificationBadge.tsx).
 */
export const DECKY = {
  /** Decky's notification badge: CSS `orange`, the dot on a plugin with an update. */
  notification: "#ffa500",
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

/** Our Details card gradient, shared with text contrast measurement. */
export const DETAILS_CARD_COLOURS = ["rgb(37, 40, 46)", "rgb(66, 69, 76)"] as const;
export const DETAILS_CARD_GRADIENT = `radial-gradient(at left top in srgb, ${DETAILS_CARD_COLOURS[1]}, ${DETAILS_CARD_COLOURS[0]})`;

/**
 * Steam's feedback box on a Steam game's page ("Valve's testing indicates
 * that … is Verified on Steam Deck"), measured from its computed styles and
 * CSS rules on the Deck (DEVICE 2026-11-26, Baldur's Gate 3's page; guide
 * device-notes §8.4h). The WoW addons box copies it: its class module loads
 * with the page, so it is not in Decky's class map to borrow at runtime.
 */
export const STEAM_PAGE_BOX = {
  background: "rgba(103, 112, 123, 0.2)",
  margin: "10px 24px",
  padding: "0 10px",
  /** The text column: Steam's padding, plus a row for our bar below it. */
  textPadding: "10px 30px 20px 10px",
  text: "#ffffff",
  /** Steam's "Verified" green, bold. */
  count: STEAM.positive,
  buttonPrimary: "#40afff",
  buttonSecondary: STEAM.textDisabled,
  buttonPadding: "10px 24px",
  buttonMargin: "0 5px",
  buttonRadius: "2px",
  focusBackground: "#ffffff",
  focusText: "#000000",
} as const;

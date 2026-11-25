/**
 * WoW's item quality colours for the Ledger's item names (spec #323), read
 * as the game shows them: 0 Poor … 8 WoW Token. A name sits on its row's
 * own background, Steam's `#23262e`, not the dialog's `#0e141b` (DEVICE
 * 2026-11-25, LEDGER-323-3). Rare and epic are lightened, keeping their
 * hue, to reach 4.5:1 there: WoW's own `#0070dd` and `#a335ee` reach about
 * 3.1:1, and the first lightening, made for `#0e141b`, 3.7:1.
 */
/**
 * `whiteOnFocus`: the colour falls under 4.5:1 on Steam's row focus
 * highlight, measured `#383a41` in the dialog (DEVICE 2026-11-25) and
 * `#3d4450` in design-language.md (Row focus), so the name turns white
 * while its row has focus.
 */
type QualityColour = { colour: string; whiteOnFocus: boolean };

const QUALITY_COLOURS: Readonly<Record<number, QualityColour>> = {
  0: { colour: "#9d9d9d", whiteOnFocus: true },
  1: { colour: "#ffffff", whiteOnFocus: false },
  2: { colour: "#1eff00", whiteOnFocus: false },
  3: { colour: "#178dff", whiteOnFocus: true }, // WoW's #0070dd, lightened
  4: { colour: "#ba67f2", whiteOnFocus: true }, // WoW's #a335ee, lightened
  5: { colour: "#ff8000", whiteOnFocus: true },
  6: { colour: "#e6cc80", whiteOnFocus: false },
  7: { colour: "#00ccff", whiteOnFocus: false },
  8: { colour: "#00ccff", whiteOnFocus: false },
};

/** A name's colour for a quality, or null for an unknown one (the usual text colour). */
export const itemQualityColour = (quality: number | null): QualityColour | null =>
  (quality === null ? undefined : QUALITY_COLOURS[quality]) ?? null;

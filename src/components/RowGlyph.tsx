import type { ReactNode } from "react";
import { Spinner } from "@decky/ui";
import { FaChevronRight } from "react-icons/fa";

/**
 * A glyph in a Field's right column, centered on the whole row. Field centers
 * its label, not its right column, so a bare icon sits level with the label's
 * first line (18.7 px above center on a row with a description; DEVICE,
 * 2026-11-12). Reserve the glyph's width in that column, then center it
 * against Field's positioned box. Leaving the inline position automatic keeps
 * Steam's own right inset. Any right-column icon or spinner goes through this.
 */
export function RowGlyph({ children, width = "1em" }: { children: ReactNode; width?: string }) {
  return (
    <span aria-hidden="true" style={{ display: "block", width }}>
      <span
        style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", display: "flex" }}
      >
        {children}
      </span>
    </span>
  );
}

/** The chevron of a row that opens a modal or sub page. */
export function RowChevron() {
  return (
    <RowGlyph>
      <FaChevronRight />
    </RowGlyph>
  );
}

/** Steam's spinner in a row's right column, while the row's action runs. */
export function RowSpinner() {
  return (
    <RowGlyph width="1.2em">
      <Spinner style={{ width: "1.2em" }} />
    </RowGlyph>
  );
}

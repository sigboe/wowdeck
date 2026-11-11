import { FaChevronRight } from "react-icons/fa";

/**
 * Field centers its label, not its right column. Reserve the icon's width
 * in that column, then center the glyph against Field's positioned box.
 * Leaving the inline position automatic keeps Steam's own right inset.
 */
export function RowChevron() {
  return (
    <span aria-hidden="true" style={{ display: "block", width: "1em" }}>
      <span
        style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", display: "flex" }}
      >
        <FaChevronRight />
      </span>
    </span>
  );
}

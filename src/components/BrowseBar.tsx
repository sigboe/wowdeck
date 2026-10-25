import type { ReactNode } from "react";
import { Focusable, PanelSectionRow } from "@decky/ui";
import type { GetAddonsTab } from "../browseSessionState";
import type { ProviderCategory, ProviderInfo } from "../types";
import { browseBarItems, validDiscoverSources, type BrowseBarItem } from "../sourceAccess";
import { browseFocusView } from "../browseSessionState";
import { providerLabel } from "../addonRow";
import { BAR_DROPDOWN_VALUE } from "./dropdownValue";
import { STEAM, STEAM_FONT } from "../steamTheme";
import { FocusSlot } from "./FocusSlot";
import { SegmentMenu } from "./SegmentMenu";

/**
 * The bar segments' focus-memory ids within the destination's browse view.
 * With the segments' menus opening in-pane (ADR 0002 revision 2026-10-24) a
 * menu no longer hides the QAM window or remounts the panel (G4) — SegmentMenu
 * itself keeps focus inside the pane. What REMEMBERing a segment still serves:
 * GetAddonsTab's Left handling in the pane reads which segment has focus to
 * route Left between them (Steam has cleared DOM focus by the time the button
 * event reaches us, DEVICE 2026-10-23), and a pick remembers its segment so a
 * later pane entry lands on the bar the list was reset from, not on a row of
 * the old list.
 */
export const SEGMENT_FOCUS: Record<BrowseBarItem, string> = {
  source: "bar:source",
  category: "bar:category",
};

/**
 * The focus-memory key of a bar segment, or null for any other key. GetAddonsTab
 * reads it to keep Left inside the bar: the memory is the live record of which
 * pane control has focus, because Steam clears DOM focus before a button event
 * reaches us (DEVICE 2026-10-23).
 */
export function segmentOfFocusKey(key: string | undefined): BrowseBarItem | null {
  return key === SEGMENT_FOCUS.source || key === SEGMENT_FOCUS.category
    ? (key.slice(4) as BrowseBarItem)
    : null;
}

const SEGMENT_LABELS: Record<BrowseBarItem, string> = { source: "Source", category: "Category" };

/** The caption over a segment's button: Steam's row label, one size down. */
const SEGMENT_LABEL = {
  color: STEAM.text,
  fontSize: STEAM_FONT.small,
  lineHeight: "16px",
  fontWeight: "bold",
  letterSpacing: ".5px",
  textTransform: "uppercase",
  padding: "0 0 4px 2px",
} as const;

/**
 * The browse bar (glossary, ADR 0002): the pane's one picker row above the
 * results. Its items are the per-destination registry's segments that the
 * loaded sources can act on — `browseBarItems`, the pure decision layer — and
 * this component renders whatever that set is, in the fixed order Source
 * then Category. A hidden segment is not rendered, so the rest close up to
 * the left; an empty set is no bar at all. Nothing to choose is never
 * advertised, and never more than one row.
 */
export function BrowseBar({
  destination,
  providers,
  sourceId,
  categoryId,
  categories,
  onSource,
  onCategory,
}: {
  destination: GetAddonsTab;
  providers: ProviderInfo[];
  /** The destination's picked source; its list store owns the pick. */
  sourceId: string | null;
  /** Popular only: the picked category; null is All categories. */
  categoryId: string | null;
  /** The active source's categories, as fetched (empty: none it can act on). */
  categories: ProviderCategory[];
  onSource: (providerId: string) => void;
  onCategory: (categoryId: string | null) => void;
}) {
  const items = browseBarItems(destination, providers, categories.length > 0);
  if (items.length === 0) {
    return null;
  }

  // A segment's menu opens inside the pane (SegmentMenu, ADR 0002 revision
  // 2026-10-24): a Steam context-menu popup hides the QAM BrowserView, and
  // its close replays Steam's QAM entrance — the motion PC-20 reported —
  // besides unmounting the panel for the popup's duration (G4). In-pane, the
  // QAM never hides, the panel stays mounted and focus never leaves the pane.
  const segments: Record<BrowseBarItem, ReactNode> = {
    source: (
      <SegmentMenu
        menuLabel="Source"
        // Only sources that work are entries: nothing "(off)" or "(not set
        // up)" — enablement is Options' business (ADR 0002).
        choices={validDiscoverSources(providers).map((p) => ({
          data: p.id,
          label: providerLabel(p.id),
        }))}
        selected={sourceId}
        // The source's name alone; the menu's entries are working sources,
        // so there is nothing more to say.
        renderValue={BAR_DROPDOWN_VALUE}
        onPick={onSource}
      />
    ),
    category: (
      <SegmentMenu
        menuLabel="Category"
        choices={[
          { data: null, label: "All categories" },
          ...categories.map((c) => ({ data: c.id as string | null, label: c.name })),
        ]}
        selected={categoryId}
        renderValue={BAR_DROPDOWN_VALUE}
        onPick={(id) => onCategory(id ?? null)}
      />
    ),
  };

  // One row, inline segments in fixed order; the halves trade width with the
  // segments that exist, so a hidden one leaves no hole. Each segment is
  // Valve's filter-bar shape (the Library's sort/filter row): a caption over a
  // bare dropdown button. Two DropdownItem rows side by side overlapped —
  // each Field's focus highlight reaches 16 px past its box (DEVICE
  // 2026-10-23) — while a bare button's highlight is the button itself.
  return (
    <PanelSectionRow>
      <Focusable
        className="wowdeck-browse-bar"
        flow-children="row"
        style={{ display: "flex", gap: "12px", paddingBottom: "8px" }}
      >
        {items.map((item) => (
          <div
            key={item}
            data-wowdeck-segment={item}
            style={{ flex: "1 1 0", minWidth: 0, position: "relative" }}
          >
            <FocusSlot view={browseFocusView(destination)} id={SEGMENT_FOCUS[item]}>
              <div style={SEGMENT_LABEL}>{SEGMENT_LABELS[item]}</div>
              {segments[item]}
            </FocusSlot>
          </div>
        ))}
      </Focusable>
    </PanelSectionRow>
  );
}

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Field,
  Focusable,
  GamepadButton,
  Navigation,
  PanelSectionRow,
  type GamepadEvent,
} from "@decky/ui";
import type {
  TradeSkillMasterLedger,
  TradeSkillMasterLedgerItem,
  TradeSkillMasterLedgerItemSort,
  TradeSkillMasterLedgerItemsParams,
} from "../../backend/src/api/contracts";
import { itemQualityColour } from "../itemQuality";
import { rememberFocus } from "../focusMemory";
import { descriptionStyle } from "../steamTheme";
import { ledgerParams } from "../tsmLedgerFilters";
import { useTsmLedgerItems } from "../tsmReads";
import { tsmView } from "../tsmView";
import { ledgerItemLabel, wowheadItemUrl } from "../tsmWowhead";
import { Money } from "./Money";
import { ScrollBuffer } from "./ScrollBuffer";
import { RECORDS_VIEW, RecordsView } from "./TsmRecords";

/** A cell of the list: "–" for nothing, so the amounts stand out (owner, PR #318 review). */
const Amount = ({ copper }: { copper: number }) =>
  Math.round(copper) === 0 ? (
    <span className="wowdeck-ledger-items-none">–</span>
  ) : (
    <Money copper={copper} />
  );

/** A count of items: "–" for none, like an amount. */
const Count = ({ count }: { count: number }) =>
  count === 0 ? (
    <span className="wowdeck-ledger-items-none">–</span>
  ) : (
    <span>{count.toLocaleString("en-US")}</span>
  );

/**
 * The slot for the item's icon, left of the name and the figures and as
 * tall as both lines (owner, PR #318 review). It stays empty until the
 * icons have a source (#335), and an empty slot takes no room. An icon there
 * narrows only the empty Item track under the name: the figure columns
 * keep their widths and stay under their labels.
 */
function ItemIcon(_: { item: TradeSkillMasterLedgerItem }): ReactNode {
  return null;
}

/** The item's name in its rarity colour; unknown keeps the row's text colour. */
function ItemName({ item }: { item: TradeSkillMasterLedgerItem }) {
  const colour = itemQualityColour(item.quality);
  return (
    <span className="wowdeck-ledger-items-item">
      <span
        className={
          colour?.whiteOnFocus
            ? "wowdeck-ledger-items-name wowdeck-ledger-items-name-focus"
            : "wowdeck-ledger-items-name"
        }
        style={colour ? { color: colour.colour } : undefined}
      >
        {ledgerItemLabel(item.name, item.itemString)}
      </span>
    </span>
  );
}

type SortColumn = Exclude<TradeSkillMasterLedgerItemSort, "volume">;
/** A column's sort; null is the usual order, earned plus spent, highest first. */
type ItemsSort = { column: SortColumn; descending: boolean } | null;

/** The list's columns, in order (spec #323). */
const COLUMNS: { column: SortColumn; label: string }[] = [
  { column: "name", label: "Item" },
  { column: "sold", label: "Sold" },
  { column: "earned", label: "Earned" },
  { column: "bought", label: "Bought" },
  { column: "spent", label: "Spent" },
  { column: "net", label: "Net" },
];

/**
 * A on a column header: highest first (A to Z for Item), then lowest
 * first, then off. Another column starts at its own first state.
 */
function nextSort(sort: ItemsSort, column: SortColumn): ItemsSort {
  const first = column !== "name";
  if (sort?.column !== column) return { column, descending: first };
  return sort.descending === first ? { column, descending: !first } : null;
}

/**
 * A column label and its sort arrow. Unsorted cells keep the arrow's room,
 * so the columns keep their widths as a sort turns on and off. The number
 * columns are right-aligned, so their arrow and its room come first: room
 * after the label left their text 13.68 px short of the values under it
 * (DEVICE 2026-11-26, LEDGER-PILL-3 recheck at 83f06a3).
 */
function HeaderLabel({
  label,
  leading,
  arrow,
}: {
  label: string;
  leading: boolean;
  arrow: string | null;
}) {
  const mark =
    arrow !== null ? (
      <span className="wowdeck-ledger-items-arrow">{leading ? `${arrow} ` : ` ${arrow}`}</span>
    ) : (
      <span
        className={
          leading ? "wowdeck-ledger-items-arrow-room-lead" : "wowdeck-ledger-items-arrow-room"
        }
        aria-hidden
      />
    );
  return (
    <span>
      {leading && mark}
      {label}
      {!leading && mark}
    </span>
  );
}

/** The header cell's padding on each side: its text lines up with the rows'. */
const HEADER_CELL_PADDING_PX = 6;

/**
 * Each row is its own Steam Field, so each is its own grid. One set of
 * column widths for the header and every row of the page keeps them
 * aligned: Item takes what is left (its label above, a row's name on the
 * line over the figures); every other column is as wide as its widest cell
 * on one line. Measured from the cells' inline content,
 * which keeps its natural width whatever its column's width.
 */
function useColumnWidths(table: RefObject<HTMLDivElement | null>, deps: unknown[]) {
  useLayoutEffect(() => {
    const el = table.current;
    if (!el) return;
    const widths = COLUMNS.map(() => 0);
    for (const row of el.querySelectorAll(".wowdeck-ledger-items-columns")) {
      const header = row.classList.contains("wowdeck-ledger-items-labels");
      [...row.children].forEach((cell, index) => {
        const content = cell.firstElementChild;
        if (index === 0 || !content) return;
        const width =
          content.getBoundingClientRect().width + (header ? 2 * HEADER_CELL_PADDING_PX : 0);
        widths[index] = Math.max(widths[index]!, Math.ceil(width));
      });
    }
    el.style.setProperty(
      "--wowdeck-ledger-items-tracks",
      ["minmax(0, 1fr)", ...widths.slice(1).map((w) => `${w}px`)].join(" "),
    );
  }, deps);
}

/**
 * Where the Ledger was left (P6: module scope, so it survives switching
 * views, leaving the destination, the QAM closing and Wowhead's round trip,
 * as S21 keeps a place): the pages turned so far for one filter selection,
 * and the sort, which another selection keeps.
 */
let kept: { key: string; offsets: number[] } | null = null;
let keptSort: ItemsSort = null;

/**
 * The item opened on Wowhead. Steam's browser closes the QAM; entering the
 * destination again lands on that item's row, once (owner, PR #318
 * review), while the Ledger still shows the same selection.
 */
let resume: { key: string; itemString: string } | null = null;

/** Test hook: the Ledger back on page 1, in the usual order, with no item to land on. */
export function resetLedgerPlace(): void {
  kept = null;
  keptSort = null;
  resume = null;
}

/** The marker on an item row's cells, which takeLedgerResume's finder looks up. */
const ITEM_ATTRIBUTE = "data-wowdeck-ledger-item";

/**
 * Entering the destination after Wowhead: a finder for the row of the item
 * opened there, while the Ledger shows and its selection is unchanged;
 * otherwise null. Taken once.
 */
export function takeLedgerResume(): ((pane: HTMLElement) => HTMLElement | null) | null {
  const item = resume;
  resume = null;
  if (!item || tsmView.get() !== "ledger" || kept?.key !== item.key) return null;
  return (pane) =>
    [...pane.querySelectorAll(`[${ITEM_ATTRIBUTE}]`)]
      .find((cells) => cells.getAttribute(ITEM_ATTRIBUTE) === item.itemString)
      ?.closest<HTMLElement>(".Focusable[tabindex]") ?? null;
}

/** The focus-memory key of an item's row (S21): its identity, not its place. */
const itemFocusKey = (itemString: string) => `ledger-item:${itemString}`;

/**
 * The column header sticks under the floating title row (owner, PR #318
 * review: six columns of figures can't be read without their names). The
 * title row's height is its offset (--wowdeck-pane-bar-height, set by
 * TsmDestination); it ends in Valve's scroll fade only while rows scroll
 * under it.
 */
function useStuckHeader(head: RefObject<HTMLDivElement | null>, deps: unknown[]) {
  useEffect(() => {
    const el = head.current;
    const scroller = el?.closest<HTMLElement>(".wowdeck-pane-slot");
    if (!el || !scroller) return;
    const onScroll = () => {
      const offset = parseFloat(scroller.style.getPropertyValue("--wowdeck-pane-bar-height")) || 0;
      const stuck =
        scroller.scrollTop > 0 &&
        el.getBoundingClientRect().top - scroller.getBoundingClientRect().top <= offset + 1;
      el.toggleAttribute("data-wowdeck-scrolled", stuck);
    };
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, deps);
}

function LedgerItems({
  listKey,
  params,
  wowhead,
}: {
  /** The filter selection's identity: another one is another list, from page 1. */
  listKey: string;
  params: TradeSkillMasterLedgerItemsParams;
  /** The installation's Wowhead section (TradeSkillMasterLedger.wowhead). */
  wowhead: string | null;
}) {
  const [offsets, setOffsets] = useState(() => (kept?.key === listKey ? kept.offsets : [0]));
  const [sort, setSort] = useState(keptSort);
  useEffect(() => {
    kept = { key: listKey, offsets };
    keptSort = sort;
  }, [listKey, offsets, sort]);
  const offset = offsets[offsets.length - 1]!;
  const { data, error } = useTsmLedgerItems({
    ...params,
    offset,
    ...(sort && { sort: sort.column, descending: sort.descending }),
  });
  const firstRow = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const headerCells = useRef<(HTMLDivElement | null)[]>([]);
  // A turned page lands on its first row when it arrives: the Previous page
  // or Next page row that had focus is gone. Showing the view takes no
  // focus: the pill or the control that showed it keeps it.
  const focusPage = useRef(false);
  // After a sort, focus stays on the header while the new order reads;
  // should the answer leave nothing to sort (the file changed meanwhile),
  // it moves to the list.
  const sortPending = useRef(false);
  useEffect(() => {
    if ((focusPage.current || (sortPending.current && !showHeader)) && firstRow.current) {
      focusPage.current = false;
      firstRow.current.focus();
    }
    if (data !== null || error) sortPending.current = false;
  }, [data, error]);

  const changePage = (next: number[]) => {
    focusPage.current = true;
    setOffsets(next);
  };
  /** The header cell of the sorted column, or Item in the usual order. */
  // Steam scrolls a node it focuses into view, and the header's own place is
  // the top of the list: Y on row 15 jumped the list from 241 px to 0
  // (DEVICE 2026-11-25, LEDGER-323-1). The header stays stuck in view, so
  // the list keeps its place: written back as soon as focus moves, and again
  // once Steam's scroll has run (F9). On the Deck the list never drew a
  // frame at the top (DEVICE 2026-11-25, recheck at 0f8dfc8); a negative
  // scroll-margin-top on the cells did not stop Steam's scroll.
  const restoreScroll = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(restoreScroll.current), []);
  const focusHeader = (index = sort ? COLUMNS.findIndex((c) => c.column === sort.column) : 0) => {
    const cell = headerCells.current[index];
    if (!cell) return;
    const scrolled: [HTMLElement, number][] = [];
    for (let el = table.current?.parentElement; el; el = el.parentElement) {
      if (el.scrollTop > 0) scrolled.push([el, el.scrollTop]);
    }
    cell.focus();
    const restore = () => scrolled.forEach(([el, top]) => (el.scrollTop = top));
    restore();
    clearTimeout(restoreScroll.current);
    restoreScroll.current = setTimeout(restore, 60);
  };
  /** The list's first focus stop: Previous page when shown, else its first row. */
  const focusList = () => {
    clearTimeout(restoreScroll.current);
    list.current?.querySelector<HTMLElement>(".Focusable")?.focus();
  };
  // A on a header cell: the new order from page 1, with focus kept on the
  // cell, so A again reverses or turns it off. A pane scrolled into the
  // list goes back to where the header meets the list's top.
  const sortBy = (column: SortColumn) => {
    focusPage.current = false;
    sortPending.current = true;
    setSort(nextSort(sort, column));
    setOffsets([0]);
    clearTimeout(restoreScroll.current);
    const scroller = table.current?.closest<HTMLElement>(".wowdeck-pane-slot");
    const top = table.current?.offsetTop;
    if (scroller && top !== undefined && scroller.scrollTop > top) scroller.scrollTop = top;
  };
  const nextOffset = data?.nextOffset ?? null;
  const previous = offsets.length > 1 ? () => changePage(offsets.slice(0, -1)) : null;
  const next = nextOffset !== null ? () => changePage([...offsets, nextOffset]) : null;
  // L2 and R2 turn the page from any row, as Steam's lists page with the
  // triggers; the Previous page and Next page rows stay at the list's ends.
  const paging = {
    actionDescriptionMap: {
      ...(previous && { [GamepadButton.TRIGGER_LEFT]: "Previous page" }),
      ...(next && { [GamepadButton.TRIGGER_RIGHT]: "Next page" }),
    },
    onButtonDown: (evt: GamepadEvent) => {
      const turn =
        evt.detail.button === GamepadButton.TRIGGER_LEFT
          ? previous
          : evt.detail.button === GamepadButton.TRIGGER_RIGHT
            ? next
            : null;
      if (turn) {
        evt.preventDefault();
        evt.stopPropagation();
        turn();
      }
    },
  };
  const rows = data !== null && !error ? data.rows : [];
  // The header stays while a new order or page reads, so the cell that
  // asked for it keeps focus; an empty list has no columns to sort.
  const listed = useRef(false);
  if (rows.length > 0) listed.current = true;
  if (data !== null && !error && data.rows.length === 0) listed.current = false;
  const showHeader = rows.length > 0 || listed.current;
  useColumnWidths(table, [data, sort, showHeader]);
  useStuckHeader(head, [showHeader]);
  // Up from the list's first focus stop reaches the header.
  const topRow = {
    onButtonDown: (evt: GamepadEvent) => {
      if (evt.detail.button === GamepadButton.DIR_UP && showHeader) {
        evt.preventDefault();
        evt.stopPropagation();
        focusHeader();
        return;
      }
      paging.onButtonDown(evt);
    },
  };
  // The list's first focus stop: Previous page when shown, else its first row.
  const firstStop = previous ? {} : topRow;
  // Y on any item jumps to the header.
  const toHeader = {
    onOptionsActionDescription: "Sort",
    onOptionsButton: () => focusHeader(),
  };
  // A header cell's buttons: Left and Right move along the header, Down
  // leads into the list. Right on the last cell rings (S29); Left on the
  // first is the pane's, back to the destination list; Up is Steam's, to
  // the filters above.
  const onHeaderButtonDown = (index: number) => (evt: GamepadEvent) => {
    const button = evt.detail.button;
    const step =
      button === GamepadButton.DIR_LEFT ? -1 : button === GamepadButton.DIR_RIGHT ? 1 : 0;
    const to = index + step;
    if ((step !== 0 && to >= 0 && to < COLUMNS.length) || button === GamepadButton.DIR_DOWN) {
      evt.preventDefault();
      evt.stopPropagation();
      if (step !== 0) focusHeader(to);
      else focusList();
      return;
    }
    paging.onButtonDown(evt);
  };
  // A opens the item on Wowhead in Steam's browser, which closes the QAM;
  // entering the destination again comes back to this row (takeLedgerResume).
  const openOnWowhead = (url: string, itemString: string) => {
    resume = { key: listKey, itemString };
    rememberFocus(RECORDS_VIEW, itemFocusKey(itemString));
    Navigation.NavigateToExternalWeb(url);
  };
  const row = (child: ReactNode) => <PanelSectionRow>{child}</PanelSectionRow>;
  return (
    <div ref={table} className="wowdeck-ledger-items">
      {/* The column headers stay in place while the items scroll under
          them: outside the scroll buffer, which counts them as floating
          over the list (S21). Each is a focus stop that sorts by its
          column (spec #323). */}
      {showHeader && (
        <div ref={head} className="wowdeck-ledger-items-head">
          <PanelSectionRow>
            <Focusable
              flow-children="row"
              className="wowdeck-ledger-items-columns wowdeck-ledger-items-labels"
            >
              {COLUMNS.map(({ column, label }, index) => (
                <Focusable
                  key={column}
                  ref={(el: HTMLDivElement | null) => {
                    headerCells.current[index] = el;
                  }}
                  className="wowdeck-ledger-items-sort"
                  noFocusRing
                  onActivate={() => sortBy(column)}
                  onOKActionDescription="Sort"
                  onButtonDown={onHeaderButtonDown(index)}
                  actionDescriptionMap={paging.actionDescriptionMap}
                >
                  <HeaderLabel
                    label={label}
                    leading={column !== "name"}
                    arrow={sort?.column === column ? (sort.descending ? "▼" : "▲") : null}
                  />
                </Focusable>
              ))}
            </Focusable>
          </PanelSectionRow>
        </div>
      )}
      <ScrollBuffer key={`${sort?.column}:${sort?.descending}:${offset}`}>
        <div ref={list}>
          {previous &&
            row(
              <Field
                focusable
                label="Previous page"
                onOKActionDescription="Previous page"
                onClick={previous}
                {...paging}
                {...topRow}
              />,
            )}
          {error
            ? row(<Field ref={firstRow} focusable label={error} {...firstStop} />)
            : data === null
              ? row(<Field focusable label="Reading Ledger items…" {...firstStop} />)
              : data.rows.length === 0
                ? row(
                    <Field
                      ref={firstRow}
                      focusable
                      label={
                        offset === 0
                          ? "No items bought or sold for these filters"
                          : "No items on this page"
                      }
                      {...firstStop}
                    />,
                  )
                : data.rows.map((item, index) => {
                    const { itemString, sold, earned, bought, spent, net } = item;
                    const url = wowheadItemUrl(wowhead, itemString);
                    const focusKey = itemFocusKey(itemString);
                    return (
                      <PanelSectionRow key={`${index}:${itemString}`}>
                        <Field
                          ref={index === 0 ? firstRow : undefined}
                          focusable
                          childrenLayout="below"
                          childrenContainerWidth="max"
                          onGamepadFocus={() => rememberFocus(RECORDS_VIEW, focusKey)}
                          {...paging}
                          {...(index === 0 && firstStop)}
                          {...toHeader}
                          // No ID or no section: no action.
                          {...(url && {
                            onOKActionDescription: "Open on Wowhead",
                            onClick: () => openOnWowhead(url, itemString),
                          })}
                        >
                          {/* The name on a line of its own, then the five
                              figures in the header's columns: at the pane's
                              width an Item column beside them was 56 px and
                              broke names mid-word (DEVICE 2026-11-26,
                              LEDGER-PILL-3; owner's pick). */}
                          <div
                            className="wowdeck-ledger-items-row"
                            {...{ [ITEM_ATTRIBUTE]: itemString }}
                          >
                            <ItemIcon item={item} />
                            <div className="wowdeck-ledger-items-lines">
                              <ItemName item={item} />
                              <div className="wowdeck-ledger-items-columns">
                                <span />
                                <span>
                                  <Count count={sold} />
                                </span>
                                <span>
                                  <Amount copper={earned} />
                                </span>
                                <span>
                                  <Count count={bought} />
                                </span>
                                <span>
                                  <Amount copper={spent} />
                                </span>
                                <span>
                                  <Amount copper={net} />
                                </span>
                              </div>
                            </div>
                          </div>
                        </Field>
                      </PanelSectionRow>
                    );
                  })}
          {rows.length > 0 &&
            next &&
            row(
              <Field
                focusable
                label="Next page"
                onOKActionDescription="Next page"
                onClick={next}
                {...paging}
              />,
            )}
        </div>
      </ScrollBuffer>
    </div>
  );
}

/** How many items the selection has, as a line above the list (C02). */
const itemCount = (count: number) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? "item" : "items"}`;

/**
 * The Ledger (GLOSSARY): every item the player's characters bought or sold
 * for the filter selection, and Export for the records behind it. It reads
 * what the TradeSkillMaster addon recorded, needs no sign-in and only reads.
 */
export function TsmLedger({ installationId }: { installationId: string }) {
  return (
    <RecordsView installationId={installationId} withExport>
      {(ledger: TradeSkillMasterLedger) => {
        if (ledger.state !== "ready") return null;
        // The selection the engine settled on, not the one still asked for.
        const params = {
          installationId,
          exact: true,
          ...ledgerParams({ ...ledger, account: ledger.account ?? undefined }),
        };
        const listKey = JSON.stringify(params);
        return (
          <>
            {/* Plain text with no focus stop, like the Dashboard's
                recorded line. */}
            <PanelSectionRow>
              <div className="wowdeck-ledger-count" style={descriptionStyle}>
                {itemCount(ledger.itemCount)}
              </div>
            </PanelSectionRow>
            <LedgerItems key={listKey} listKey={listKey} params={params} wowhead={ledger.wowhead} />
          </>
        );
      }}
    </RecordsView>
  );
}

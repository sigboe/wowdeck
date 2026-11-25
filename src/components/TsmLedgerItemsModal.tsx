import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  Focusable,
  GamepadButton,
  ModalRoot,
  Navigation,
  showModal,
  type GamepadEvent,
} from "@decky/ui";
import type {
  TradeSkillMasterLedger,
  TradeSkillMasterLedgerItemSort,
  TradeSkillMasterLedgerItemsParams,
} from "../../backend/src/api/contracts";
import { itemQualityColour } from "../itemQuality";
import { browseFocusView, holdBrowseSessionForModal } from "../browseSessionState";
import { requestFocus } from "../focusMemory";
import { openPanel } from "../openPanel";
import { wowdeckSharedStyleCss } from "../sharedStyles";
import { ledgerParams } from "../tsmLedgerFilters";
import { useTsmLedgerItems } from "../tsmReads";
import { ledgerItemLabel, wowheadItemUrl } from "../tsmWowhead";
import { Money } from "./Money";
import { ScrollBuffer } from "./ScrollBuffer";

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

/** The header cell's padding on each side: its text lines up with the rows'. */
const HEADER_CELL_PADDING_PX = 6;

/**
 * Each row is its own Steam Field, so each is its own grid. One set of
 * column widths for the header and every row of the page keeps them
 * aligned: Item takes what is left and wraps; every other column is as wide
 * as its widest cell on one line. Measured from the cells' inline content,
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

/** Where All items was left for Wowhead: its pages so far, the item's row on the last, and its sort. */
type ItemsPlace = { offsets: number[]; index: number; sort: ItemsSort };

/**
 * The place All items was left at for Wowhead, by its filters. Steam shows
 * its browser under a QAM dialog, so A closes the list before opening the
 * page (DEVICE 2026-11-24, #319); the next A on All items with the same
 * filters reopens it there, once (owner, PR #318 review).
 */
let resume: { key: string; place: ItemsPlace } | null = null;

/** Test hook: forget where All items was left. */
export function resetLedgerItemsResume(): void {
  resume = null;
}

function LedgerItemsModal({
  params,
  filters,
  wowhead,
  start,
  openWeb,
  closeModal,
}: {
  params: TradeSkillMasterLedgerItemsParams;
  filters: string;
  /** The installation's Wowhead section (TradeSkillMasterLedger.wowhead). */
  wowhead: string | null;
  /** Where to open: page 1 and its first row, or where Wowhead was opened. */
  start: ItemsPlace;
  /** Closes the list, keeping `place` for the next open, then opens `url`. */
  openWeb: (url: string, place: ItemsPlace) => void;
  closeModal: () => void;
}) {
  const [offsets, setOffsets] = useState(start.offsets);
  const [sort, setSort] = useState(start.sort);
  const offset = offsets[offsets.length - 1]!;
  const { data, error } = useTsmLedgerItems({
    ...params,
    offset,
    ...(sort && { sort: sort.column, descending: sort.descending }),
  });
  const firstRow = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const headerCells = useRef<(HTMLDivElement | null)[]>([]);
  // Each page, the first one included, lands on its first row when it
  // arrives. Steam's dialog takes focus as it opens, often before the first
  // page: without this, focus stayed where it took it (DEVICE 2026-11-24).
  // Back from Wowhead, the first page shown lands on the item opened.
  const focusPage = useRef(true);
  const focusIndex = useRef(start.index);
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
    focusIndex.current = 0;
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
  // A on a header cell: the new order from page 1 at the top of the list,
  // with focus kept on the cell, so A again reverses or turns it off.
  const sortBy = (column: SortColumn) => {
    focusPage.current = false;
    sortPending.current = true;
    focusIndex.current = 0;
    setSort(nextSort(sort, column));
    setOffsets([0]);
    clearTimeout(restoreScroll.current);
    for (let el = table.current?.parentElement; el; el = el.parentElement) {
      if (el.scrollTop > 0) el.scrollTop = 0;
    }
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
  const focusRow = Math.min(focusIndex.current, Math.max(rows.length - 1, 0));
  // The header stays while a new order or page reads, so the cell that
  // asked for it keeps focus; an empty list has no columns to sort.
  const listed = useRef(false);
  if (rows.length > 0) listed.current = true;
  if (data !== null && !error && data.rows.length === 0) listed.current = false;
  const showHeader = rows.length > 0 || listed.current;
  useColumnWidths(table, [data, sort, showHeader]);
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
  // leads into the list. At either end, and Up, Steam's navigation runs,
  // finds nothing in the dialog and rings once (S29).
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
  return (
    <ModalRoot
      onCancel={closeModal}
      closeModal={closeModal}
      bAllowFullSize
      className="wowdeck-full-width-modal"
    >
      <style>{wowdeckSharedStyleCss()}</style>
      <DialogHeader>
        All items
        <div className="wowdeck-ledger-items-filters">{filters}</div>
      </DialogHeader>
      <DialogBody>
        <div ref={table}>
          {/* The column headers stay in place while the items scroll under
              them: outside the scroll buffer, which counts them as floating
              over the list (S21). Each is a focus stop that sorts by its
              column (spec #323). */}
          {showHeader && (
            <Focusable
              flow-children="row"
              className="wowdeck-ledger-items-columns wowdeck-ledger-items-labels wowdeck-ledger-caption"
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
                  <span>
                    {label}
                    {/* Unsorted cells keep the arrow's room, so the columns
                        keep their widths as a sort turns on and off. */}
                    {sort?.column === column ? (
                      <span className="wowdeck-ledger-items-arrow">
                        {sort.descending ? " ▼" : " ▲"}
                      </span>
                    ) : (
                      <span className="wowdeck-ledger-items-arrow-room" aria-hidden />
                    )}
                  </span>
                </Focusable>
              ))}
            </Focusable>
          )}
          <ScrollBuffer key={`${sort?.column}:${sort?.descending}:${offset}`}>
            <div ref={list}>
              <DialogControlsSection>
                {previous && (
                  <Field
                    focusable
                    label="Previous page"
                    onOKActionDescription="Previous page"
                    onClick={previous}
                    {...paging}
                    {...topRow}
                  />
                )}
                {error ? (
                  <Field ref={firstRow} focusable label={error} {...firstStop} />
                ) : data === null ? (
                  // A focus stop, so Steam's dialog takes focus here at the top
                  // of the list. With only Close to take, focus sat on Close
                  // under a full page and the header scrolled out of view
                  // (DEVICE 2026-11-24).
                  <Field focusable label="Reading Ledger items…" {...firstStop} />
                ) : data.rows.length === 0 ? (
                  <Field
                    ref={firstRow}
                    focusable
                    label={
                      offset === 0
                        ? "No items bought or sold for these filters"
                        : "No items on this page"
                    }
                    {...firstStop}
                  />
                ) : (
                  <>
                    {data.rows.map((item, index) => {
                      const { itemString, name, sold, earned, bought, spent, net, quality } = item;
                      const url = wowheadItemUrl(wowhead, itemString);
                      const colour = itemQualityColour(quality);
                      return (
                        <Field
                          key={`${index}:${itemString}`}
                          ref={index === focusRow ? firstRow : undefined}
                          focusable
                          childrenLayout="below"
                          childrenContainerWidth="max"
                          {...paging}
                          {...(index === 0 && firstStop)}
                          {...toHeader}
                          // A opens the item on Wowhead in Steam's browser. The
                          // list closes first, as Steam's browser opens under it,
                          // and the next A on All items comes back to this row
                          // (owner, PR #318 review). No ID or no section: no
                          // action.
                          {...(url && {
                            onOKActionDescription: "Open on Wowhead",
                            onClick: () => openWeb(url, { offsets, index, sort }),
                          })}
                        >
                          <div className="wowdeck-ledger-items-columns">
                            {/* The name in its rarity colour; unknown keeps the row's text colour. */}
                            <span
                              className={
                                colour?.whiteOnFocus
                                  ? "wowdeck-ledger-items-name wowdeck-ledger-items-name-focus"
                                  : "wowdeck-ledger-items-name"
                              }
                              style={colour ? { color: colour.colour } : undefined}
                            >
                              {ledgerItemLabel(name, itemString)}
                            </span>
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
                        </Field>
                      );
                    })}
                    {next && (
                      <Field
                        focusable
                        label="Next page"
                        onOKActionDescription="Next page"
                        onClick={next}
                        {...paging}
                      />
                    )}
                  </>
                )}
              </DialogControlsSection>
            </div>
          </ScrollBuffer>
        </div>
      </DialogBody>
      <DialogFooter>
        <DialogButton onClick={closeModal}>Close</DialogButton>
      </DialogFooter>
    </ModalRoot>
  );
}

export function openLedgerItems(
  installationId: string,
  ledger: TradeSkillMasterLedger,
  focusId: string,
): void {
  // Freeze the filters shown beside the figures when the row was opened.
  const params = {
    installationId,
    exact: true,
    ...ledgerParams({ ...ledger, account: ledger.account ?? undefined }),
  };
  const character = ledger.characters.find(({ id }) => id === ledger.character);
  const filters = [
    ...(ledger.accounts.length > 1 ? [ledger.account] : []),
    ledger.realm ?? "All realms",
    character?.label ?? "All characters",
    ledger.period,
  ].join(" · ");
  const key = JSON.stringify(params);
  // Every open starts in the usual order; only Wowhead's round trip keeps the sort.
  const start = resume?.key === key ? resume.place : { offsets: [0], index: 0, sort: null };
  resume = null;
  // Leaving for Wowhead, the QAM stays closed so the page shows.
  let leavingForWeb = false;
  const release = holdBrowseSessionForModal();
  const modal = showModal(
    <LedgerItemsModal
      params={params}
      filters={filters}
      wowhead={ledger.wowhead}
      start={start}
      openWeb={(url, place) => {
        resume = { key, place };
        leavingForWeb = true;
        modal.Close();
        Navigation.NavigateToExternalWeb(url);
      }}
      closeModal={() => modal.Close()}
    />,
    window,
    {
      strTitle: "All items",
      bHideMainWindowForPopouts: false,
      fnOnClose: () => {
        requestFocus(browseFocusView("tsm"), focusId);
        if (!leavingForWeb) {
          openPanel("browse");
        }
        release();
      },
    },
  );
}

import { useEffect, useRef, useState } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  GamepadButton,
  ModalRoot,
  Navigation,
  showModal,
  type GamepadEvent,
} from "@decky/ui";
import type {
  TradeSkillMasterLedger,
  TradeSkillMasterLedgerItemsParams,
} from "../../backend/src/api/contracts";
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

/** Where All items was left for Wowhead: its pages so far and the item's row on the last. */
type ItemsPlace = { offsets: number[]; index: number };

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
  const offset = offsets[offsets.length - 1]!;
  const { data, error } = useTsmLedgerItems({ ...params, offset });
  const firstRow = useRef<HTMLDivElement>(null);
  // Each page, the first one included, lands on its first row when it
  // arrives. Steam's dialog takes focus as it opens, often before the first
  // page: without this, focus stayed where it took it (DEVICE 2026-11-24).
  // Back from Wowhead, the first page shown lands on the item opened.
  const focusPage = useRef(true);
  const focusIndex = useRef(start.index);
  useEffect(() => {
    if (focusPage.current && firstRow.current) {
      focusPage.current = false;
      firstRow.current.focus();
    }
  }, [data, error]);

  const changePage = (next: number[]) => {
    focusPage.current = true;
    focusIndex.current = 0;
    setOffsets(next);
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
        {/* The column labels stay in place while the items scroll under
            them: outside the scroll buffer, which counts them as floating
            over the list (S21). */}
        {rows.length > 0 && (
          <div className="wowdeck-ledger-items-columns wowdeck-ledger-items-labels wowdeck-ledger-caption">
            <span>Item</span>
            <span>Earned</span>
            <span>Spent</span>
            <span>Net</span>
          </div>
        )}
        <ScrollBuffer key={offset}>
          <DialogControlsSection>
            {previous && (
              <Field
                focusable
                label="Previous page"
                onOKActionDescription="Previous page"
                onClick={previous}
                {...paging}
              />
            )}
            {error ? (
              <Field ref={firstRow} focusable label={error} />
            ) : data === null ? (
              // A focus stop, so Steam's dialog takes focus here at the top
              // of the list. With only Close to take, focus sat on Close
              // under a full page and the header scrolled out of view
              // (DEVICE 2026-11-24).
              <Field focusable label="Reading Ledger items…" />
            ) : data.rows.length === 0 ? (
              <Field
                ref={firstRow}
                focusable
                label={
                  offset === 0
                    ? "No items bought or sold for these filters"
                    : "No items on this page"
                }
              />
            ) : (
              <>
                {data.rows.map(({ itemString, name, earned, spent, net }, index) => {
                  const url = wowheadItemUrl(wowhead, itemString);
                  return (
                    <Field
                      key={`${index}:${itemString}`}
                      ref={index === focusRow ? firstRow : undefined}
                      focusable
                      childrenLayout="below"
                      childrenContainerWidth="max"
                      {...paging}
                      // A opens the item on Wowhead in Steam's browser. The
                      // list closes first, as Steam's browser opens under it,
                      // and the next A on All items comes back to this row
                      // (owner, PR #318 review). No ID or no section: no
                      // action.
                      {...(url && {
                        onOKActionDescription: "Open on Wowhead",
                        onClick: () => openWeb(url, { offsets, index }),
                      })}
                    >
                      <div className="wowdeck-ledger-items-columns">
                        <span>{ledgerItemLabel(name, itemString)}</span>
                        <Amount copper={earned} />
                        <Amount copper={spent} />
                        <Amount copper={net} />
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
        </ScrollBuffer>
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
  const start = resume?.key === key ? resume.place : { offsets: [0], index: 0 };
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

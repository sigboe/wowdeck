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

function LedgerItemsModal({
  params,
  filters,
  wowhead,
  closeModal,
}: {
  params: TradeSkillMasterLedgerItemsParams;
  filters: string;
  /** The installation's Wowhead section (TradeSkillMasterLedger.wowhead). */
  wowhead: string | null;
  closeModal: () => void;
}) {
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets[offsets.length - 1]!;
  const { data, error } = useTsmLedgerItems({ ...params, offset });
  const firstRow = useRef<HTMLDivElement>(null);
  // Each page, the first one included, lands on its first row when it
  // arrives. Steam's dialog takes focus as it opens, often before the first
  // page: without this, focus stayed where it took it (DEVICE 2026-11-24).
  const focusPage = useRef(true);
  useEffect(() => {
    if (focusPage.current && firstRow.current) {
      focusPage.current = false;
      firstRow.current.focus();
    }
  }, [data, error]);

  const changePage = (next: number[]) => {
    focusPage.current = true;
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
                      ref={index === 0 ? firstRow : undefined}
                      focusable
                      childrenLayout="below"
                      childrenContainerWidth="max"
                      {...paging}
                      // A opens the item on Wowhead in Steam's browser; the
                      // list stays open under it, so B comes back to this
                      // row (owner, PR #318 review). No ID or no section:
                      // no action.
                      {...(url && {
                        onOKActionDescription: "Open on Wowhead",
                        onClick: () => Navigation.NavigateToExternalWeb(url),
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
  const release = holdBrowseSessionForModal();
  const modal = showModal(
    <LedgerItemsModal
      params={params}
      filters={filters}
      wowhead={ledger.wowhead}
      closeModal={() => modal.Close()}
    />,
    window,
    {
      strTitle: "All items",
      bHideMainWindowForPopouts: false,
      fnOnClose: () => {
        requestFocus(browseFocusView("tsm"), focusId);
        openPanel("browse");
        release();
      },
    },
  );
}

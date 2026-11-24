import { useEffect, useRef, useState } from "react";
import {
  DialogBody,
  DialogButton,
  DialogControlsSection,
  DialogFooter,
  DialogHeader,
  Field,
  ModalRoot,
  showModal,
} from "@decky/ui";
import type {
  TradeSkillMasterLedger,
  TradeSkillMasterLedgerItemsParams,
} from "../../backend/src/api/contracts";
import { browseFocusView, holdBrowseSessionForModal } from "../browseSessionState";
import { requestFocus } from "../focusMemory";
import { openPanel } from "../openPanel";
import { wowdeckSharedStyleCss } from "../sharedStyles";
import { formatMoney } from "../text";
import { ledgerParams } from "../tsmLedgerFilters";
import { useTsmLedgerItems } from "../tsmReads";
import { ScrollBuffer } from "./ScrollBuffer";

function LedgerItemsModal({
  params,
  filters,
  closeModal,
}: {
  params: TradeSkillMasterLedgerItemsParams;
  filters: string;
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
        <ScrollBuffer key={offset}>
          <DialogControlsSection>
            {offsets.length > 1 && (
              <Field
                focusable
                label="Previous page"
                onOKActionDescription="Previous page"
                onClick={() => changePage(offsets.slice(0, -1))}
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
                <Field childrenLayout="below" childrenContainerWidth="max">
                  <div className="wowdeck-ledger-items-columns wowdeck-ledger-items-labels">
                    <span>Item</span>
                    <span>Earned</span>
                    <span>Spent</span>
                    <span>Net</span>
                  </div>
                </Field>
                {data.rows.map(({ itemString, name, earned, spent, net }, index) => (
                  <Field
                    key={`${index}:${itemString}`}
                    ref={index === 0 ? firstRow : undefined}
                    focusable
                    childrenLayout="below"
                    childrenContainerWidth="max"
                  >
                    <div className="wowdeck-ledger-items-columns">
                      <span>{name}</span>
                      <span>{formatMoney(earned)}</span>
                      <span>{formatMoney(spent)}</span>
                      <span>{formatMoney(net)}</span>
                    </div>
                  </Field>
                ))}
                {nextOffset !== null && (
                  <Field
                    focusable
                    label="Next page"
                    onOKActionDescription="Next page"
                    onClick={() => changePage([...offsets, nextOffset])}
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
    <LedgerItemsModal params={params} filters={filters} closeModal={() => modal.Close()} />,
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

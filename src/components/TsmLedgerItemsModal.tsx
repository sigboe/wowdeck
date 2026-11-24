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
  TradeSkillMasterLedgerParams,
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
  params: TradeSkillMasterLedgerParams;
  filters: string;
  closeModal: () => void;
}) {
  const { data, error } = useTsmLedgerItems(params);
  return (
    <ModalRoot
      onCancel={closeModal}
      closeModal={closeModal}
      bAllowFullSize
      modalClassName="wowdeck-ledger-items-modal"
    >
      <style>{wowdeckSharedStyleCss()}</style>
      <DialogHeader>
        All items
        <div className="wowdeck-ledger-items-filters">{filters}</div>
      </DialogHeader>
      <DialogBody>
        <ScrollBuffer>
          <DialogControlsSection>
            {error ? (
              <Field focusable label={error} />
            ) : data === null ? (
              <Field label="Reading Ledger items…" />
            ) : data.length === 0 ? (
              <Field focusable label="No items bought or sold for these filters" />
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
                {data.map(({ itemString, name, earned, spent, net }) => (
                  <Field
                    key={itemString}
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

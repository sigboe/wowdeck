import { useSyncExternalStore, type ReactNode } from "react";
import { DialogButton, Field, PanelSectionRow } from "@decky/ui";
import type {
  TradeSkillMasterLedger,
  TradeSkillMasterLedgerPeriod,
  TradeSkillMasterLedgerState,
} from "../../backend/src/api/contracts";
import { browseFocusView } from "../browseSessionState";
import { requestFocus } from "../focusMemory";
import { useTsmLedger } from "../tsmReads";
import { pickLedgerFilter } from "../tsmLedgerFilters";
import { exportLedger, ledgerExport } from "../tsmLedgerExport";
import { FocusSlot, focusTarget } from "./FocusSlot";
import { SegmentRow, type BarSegment } from "./BrowseBar";
import { SegmentMenu } from "./SegmentMenu";
import {
  LEDGER_FULL_VALUE,
  LEDGER_HALF_VALUE,
  LEDGER_PERIOD_VALUE,
  LEDGER_PERIOD_WIDTH,
} from "./dropdownValue";

/**
 * What the Dashboard and the Ledger share (GLOSSARY): both read
 * TradeSkillMaster's records for one filter selection (tsmLedgerFilters),
 * with the same filter controls at the top, and say the same when there is
 * nothing to show. They read through one keyed resource, so switching
 * between them reads nothing again.
 */

/** What an empty view says, by the engine's reason. */
const EMPTY: Record<Exclude<TradeSkillMasterLedgerState, "ready">, [string, string]> = {
  noAddon: [
    "Install TradeSkillMaster to start recording",
    "The addon records your sales, purchases and gold while you play",
  ],
  noAccount: [
    "Nothing recorded yet",
    "Play a character with TradeSkillMaster enabled, then log out or /reload to save its records",
  ],
  noRecords: [
    "No sales, purchases or gold recorded yet",
    "TradeSkillMaster records them while you play and saves them when you log out or /reload",
  ],
};

/** The destination's focus memory (S21, R1): both views' rows report there. */
export const RECORDS_VIEW = browseFocusView("tsm");
/**
 * The shared rows' keys. Only one view shows at a time, so a control keeps
 * its key in both: a rebuilt pane lands on Realm whichever view shows it.
 */
export const RECORDS_FOCUS = {
  error: "records-error",
  empty: "records-empty",
  account: "records-account",
  realm: "records-realm",
  character: "records-character",
  period: "records-period",
  export: "records-export",
} as const;

/**
 * Bar segments that sit beside another on their row, by focus key: Left
 * from the key goes to its value (GetAddonsTab's pane Left handling;
 * Steam's own row navigation skipped the sibling and left the pane, DEVICE
 * 2026-10-23). Up and Down between the rows are Steam's own.
 */
export const RECORDS_LEFT_NEIGHBOUR: Record<string, string> = {
  [RECORDS_FOCUS.character]: RECORDS_FOCUS.realm,
  [RECORDS_FOCUS.period]: RECORDS_FOCUS.character,
};

/** The in-game Dashboard's periods, in its order. */
const PERIODS: TradeSkillMasterLedgerPeriod[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "2Y", "All"];

/**
 * Export as a Steam settings row (S19): what it writes as the description,
 * the button on the right. Export writes the shown account's records for
 * the shown realm, or every realm, whatever Character and Period show, and
 * the description says so (owner, PR #318 review). Without records there
 * (gold logs are none) the button is disabled and takes no focus: Steam's
 * navigation stopped on a disabled button although A did nothing there
 * (DEVICE 2026-11-24).
 */
function ExportRow({
  installationId,
  ledger,
}: {
  installationId: string;
  ledger: TradeSkillMasterLedger;
}) {
  const { exporting } = useSyncExternalStore(ledgerExport.subscribe, ledgerExport.get);
  const canExport = ledger.exportable && ledger.account !== null;
  return (
    <PanelSectionRow>
      <div className="wowdeck-ledger-export">
        <Field
          label="Export ledger"
          description={
            canExport
              ? `${ledger.realm ?? "All realms"} · every character and period`
              : "Nothing to export yet"
          }
        >
          {canExport ? (
            <FocusSlot view={RECORDS_VIEW} id={RECORDS_FOCUS.export}>
              <DialogButton
                onClick={() =>
                  void exportLedger(installationId, ledger, () =>
                    requestFocus(RECORDS_VIEW, RECORDS_FOCUS.export),
                  )
                }
                onOKActionDescription="Export"
                style={{ minWidth: 0, width: "auto", padding: "10px 24px" }}
              >
                {exporting ? "Exporting…" : "Export"}
              </DialogButton>
            </FocusSlot>
          ) : (
            <DialogButton
              disabled
              focusable={false}
              onClick={() => {}}
              style={{ minWidth: 0, width: "auto", padding: "10px 24px" }}
            >
              Export
            </DialogButton>
          )}
        </Field>
      </div>
    </PanelSectionRow>
  );
}

/**
 * The filter controls, at the top of a view's rows and scrolling with them
 * (owner, PR #318 review: only the title row floats): Account, only with
 * more than one account; Export, on the Ledger only; then Realm, Character
 * and Period as the browse bar's segments with in-pane menus (ADR 0002,
 * G14), once the account has records.
 */
function RecordsControls({
  installationId,
  ledger,
  withExport,
}: {
  installationId: string;
  ledger: TradeSkillMasterLedger;
  withExport: boolean;
}) {
  const pick = (change: Parameters<typeof pickLedgerFilter>[2]) =>
    pickLedgerFilter(installationId, ledger, change);
  const account: BarSegment = {
    id: "account",
    caption: "Account",
    focusId: RECORDS_FOCUS.account,
    menu: (
      <SegmentMenu
        menuLabel="Account"
        choices={ledger.accounts.map((name) => ({ data: name, label: name }))}
        selected={ledger.account}
        renderValue={LEDGER_FULL_VALUE}
        onPick={(name) => pick({ account: name })}
      />
    ),
  };
  const filters: BarSegment[] = [
    {
      id: "realm",
      caption: "Realm",
      focusId: RECORDS_FOCUS.realm,
      menu: (
        <SegmentMenu
          menuLabel="Realm"
          choices={[
            { data: null as string | null, label: "All realms" },
            ...ledger.realms.map((realm) => ({ data: realm as string | null, label: realm })),
          ]}
          selected={ledger.realm}
          renderValue={LEDGER_HALF_VALUE}
          onPick={(realm) => pick({ realm })}
        />
      ),
    },
    {
      id: "character",
      caption: "Character",
      focusId: RECORDS_FOCUS.character,
      menu: (
        <SegmentMenu
          menuLabel="Character"
          choices={[
            { data: null as string | null, label: "All characters" },
            ...ledger.characters.map((c) => ({ data: c.id as string | null, label: c.label })),
          ]}
          selected={ledger.character}
          renderValue={LEDGER_HALF_VALUE}
          onPick={(character) => pick({ character })}
        />
      ),
    },
    {
      id: "period",
      caption: "Period",
      focusId: RECORDS_FOCUS.period,
      flex: `0 0 ${LEDGER_PERIOD_WIDTH}px`,
      menu: (
        <SegmentMenu
          menuLabel="Period"
          choices={PERIODS.map((period) => ({ data: period, label: period }))}
          selected={ledger.period}
          renderValue={LEDGER_PERIOD_VALUE}
          onPick={(period) => pick({ period })}
        />
      ),
    },
  ];
  return (
    <>
      {ledger.accounts.length > 1 && <SegmentRow view={RECORDS_VIEW} segments={[account]} />}
      {withExport && <ExportRow installationId={installationId} ledger={ledger} />}
      {ledger.state === "ready" && <SegmentRow view={RECORDS_VIEW} segments={filters} />}
    </>
  );
}

/**
 * A view of the records for the installation's filter selection: a
 * loading line on the first read, an error (never an empty view, A9), or
 * the filter controls, the view's own rows (`children`), and what an empty
 * view says once the engine found nothing to show.
 */
export function RecordsView({
  installationId,
  withExport = false,
  children,
}: {
  installationId: string;
  withExport?: boolean;
  children: (ledger: TradeSkillMasterLedger) => ReactNode;
}) {
  const { data, error, loading } = useTsmLedger(installationId);
  return (
    <>
      {loading && !data && (
        <PanelSectionRow>
          <Field label="Reading TradeSkillMaster's records…" />
        </PanelSectionRow>
      )}
      {error && (
        <PanelSectionRow>
          <Field focusable label={error} {...focusTarget(RECORDS_VIEW, RECORDS_FOCUS.error)} />
        </PanelSectionRow>
      )}
      {data && !error && (
        <>
          <RecordsControls installationId={installationId} ledger={data} withExport={withExport} />
          {children(data)}
          {data.state !== "ready" && (
            <PanelSectionRow>
              <Field
                focusable
                label={EMPTY[data.state][0]}
                description={EMPTY[data.state][1]}
                {...focusTarget(RECORDS_VIEW, RECORDS_FOCUS.empty)}
              />
            </PanelSectionRow>
          )}
        </>
      )}
    </>
  );
}

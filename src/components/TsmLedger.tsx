import { useEffect, useState } from "react";
import { ButtonItem, Field, PanelSectionRow } from "@decky/ui";
import type { TradeSkillMasterLedgerState } from "../../backend/src/api/contracts";
import { browseFocusView } from "../browseSessionState";
import { useTsmLedger } from "../tsmReads";
import { FocusSlot, focusTarget } from "./FocusSlot";
import { formatWhen } from "../text";

/** What an empty Ledger says, by the engine's reason. */
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

/** The Ledger's rows in the destination's focus memory (S21, R1). */
const FOCUS_VIEW = browseFocusView("tsm");
export const LEDGER_FOCUS = {
  error: "ledger-error",
  recorded: "ledger-recorded",
  empty: "ledger-empty",
  export: "ledger-export",
} as const;

/**
 * The Ledger (GLOSSARY): what the TradeSkillMaster addon recorded for the
 * active installation, read from the game's saved settings. It needs no
 * TradeSkillMaster sign-in and only reads.
 */
export function TsmLedger({ installationId }: { installationId: string }) {
  const { data, error, loading } = useTsmLedger(installationId);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <>
      {loading && !data && (
        <PanelSectionRow>
          <Field label="Reading TradeSkillMaster's records…" />
        </PanelSectionRow>
      )}
      {error && (
        <PanelSectionRow>
          <Field focusable label={error} {...focusTarget(FOCUS_VIEW, LEDGER_FOCUS.error)} />
        </PanelSectionRow>
      )}
      {data && !error && (
        <>
          {/* Without the addon nothing records, so nothing is dated. */}
          {data.recordedAt !== null && data.state !== "noAddon" && (
            <PanelSectionRow>
              {/* Focusable, so the D-pad reaches the top of the view (G3). */}
              <Field
                focusable
                label={`Recorded at last logout · ${formatWhen(data.recordedAt, now)}`}
                description={
                  data.gameRunning ? "Log out or /reload to include this session" : undefined
                }
                {...focusTarget(FOCUS_VIEW, LEDGER_FOCUS.recorded)}
              />
            </PanelSectionRow>
          )}
          {data.state !== "ready" && (
            <PanelSectionRow>
              <Field
                focusable
                label={EMPTY[data.state][0]}
                description={EMPTY[data.state][1]}
                {...focusTarget(FOCUS_VIEW, LEDGER_FOCUS.empty)}
              />
            </PanelSectionRow>
          )}
        </>
      )}
      <PanelSectionRow>
        <FocusSlot view={FOCUS_VIEW} id={LEDGER_FOCUS.export}>
          <ButtonItem
            label="Export records"
            description="Export arrives in the next update"
            disabled
            onClick={() => {}}
          >
            Export
          </ButtonItem>
        </FocusSlot>
      </PanelSectionRow>
    </>
  );
}

import { useSyncExternalStore } from "react";
import { ButtonItem, PanelSectionRow } from "@decky/ui";
import { browseFocusView } from "../browseSessionState";
import { TSM_VIEWS, tsmView, type TsmView } from "../tsmView";
import { FocusSlot } from "./FocusSlot";
import { PillBar } from "./TopNav";
import { TsmAddon } from "./TsmAddon";
import { TsmLedger } from "./TsmLedger";

/**
 * The pill bar's focus-memory key in the destination's browse view. Its
 * pill reports there on focus, so GetAddonsTab's pane Left handling knows
 * the bar has focus and returns Left from the first pill to the list.
 */
export const TSM_PILL_BAR = "pill-bar";

/**
 * Where entering the destination puts focus: its first content row, never
 * the pill bar above it (as every other destination lands on its content).
 */
export function firstTsmControl(pane: HTMLElement): HTMLElement | null {
  return (
    [...pane.querySelectorAll<HTMLElement>("button.Focusable, .Focusable[tabindex]")].find(
      (e) =>
        !e.closest(".wowdeck-pill-bar") &&
        !(e as HTMLButtonElement).disabled &&
        !e.classList.contains("Disabled"),
    ) ?? null
  );
}

/**
 * The TradeSkillMaster destination (GLOSSARY): a pill bar over its two
 * views. Auction data is today's pane (or, signed out, the way back to
 * signing in); the Ledger reads the addon's own records and works signed
 * out. The view picked last stays for the session (tsmView).
 */
export function TsmDestination({
  installationId,
  signedIn,
  onSignIn,
}: {
  installationId: string | null;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const view = useSyncExternalStore(tsmView.subscribe, tsmView.get);
  return (
    <>
      {/* Navigation floats at the top of the pane (S24). */}
      <div className="wowdeck-pane-bar">
        <PanelSectionRow>
          <FocusSlot view={browseFocusView("tsm")} id={TSM_PILL_BAR}>
            <PillBar
              tabs={TSM_VIEWS}
              activeId={view}
              onSelect={(id) => tsmView.set(id as TsmView)}
            />
          </FocusSlot>
        </PanelSectionRow>
      </div>
      {view === "ledger" ? (
        installationId && <TsmLedger key={installationId} installationId={installationId} />
      ) : signedIn ? (
        installationId && <TsmAddon key={installationId} installationId={installationId} />
      ) : (
        <ButtonItem layout="below" onClick={onSignIn}>
          Sign in in Options
        </ButtonItem>
      )}
    </>
  );
}

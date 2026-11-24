import { useEffect, useRef, useSyncExternalStore } from "react";
import { ButtonItem, PanelSectionRow } from "@decky/ui";
import { browseFocusView, browseZone } from "../browseSessionState";
import { PENDING_RESTORE_MS } from "../focusMemory";
import { TSM_VIEWS, tsmView, type TsmView } from "../tsmView";
import { FocusSlot } from "./FocusSlot";
import { PillBar } from "./TopNav";
import { TsmAddon } from "./TsmAddon";
import { TsmLedger, TsmLedgerFilters } from "./TsmLedger";

/**
 * The pill bar's focus-memory key in the destination's browse view. Its
 * pill reports there on focus, so GetAddonsTab's pane Left handling knows
 * the bar has focus and returns Left from the first pill to the list.
 */
export const TSM_PILL_BAR = "pill-bar";

/**
 * Where entering the destination puts focus: its first content row, never
 * the floating bars above it (the pill bar, the Ledger's filters), as every
 * other destination lands on its content.
 */
export function firstTsmControl(pane: HTMLElement): HTMLElement | null {
  return (
    [...pane.querySelectorAll<HTMLElement>("button.Focusable, .Focusable[tabindex]")].find(
      (e) =>
        !e.closest(".wowdeck-pane-bar") &&
        !(e as HTMLButtonElement).disabled &&
        !e.classList.contains("Disabled"),
    ) ?? null
  );
}

/**
 * Entering the destination (Right or A on it in the list): focus its first
 * content row. A view still reading has none yet (the Ledger's first read
 * shows only a loading line and the disabled Export), so focus stays on the
 * list until the first row appears, for PENDING_RESTORE_MS, unless the
 * player moves first or leaves the pane. Without the wait, focus stayed on
 * the list while the pane counted itself focused.
 */
export function focusTsmEntry(pane: HTMLElement): void {
  const row = firstTsmControl(pane);
  if (row) {
    row.focus();
    return;
  }
  const doc = pane.ownerDocument;
  const win = doc.defaultView;
  if (!win) {
    return;
  }
  const from = doc.activeElement;
  const waiting = () => browseZone.zone === "pane" && doc.activeElement === from;
  const observer = new win.MutationObserver(() => {
    const found = firstTsmControl(pane);
    if (!waiting() || found) {
      stop();
    }
    if (found && waiting()) {
      // After the commit, once Steam has registered the row (guide G7).
      win.setTimeout(() => waiting() && found.focus(), 0);
    }
  });
  const timer = win.setTimeout(() => stop(), PENDING_RESTORE_MS);
  const stop = () => {
    observer.disconnect();
    win.clearTimeout(timer);
  };
  observer.observe(pane, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "disabled", "tabindex"],
  });
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
  const barRef = useRef<HTMLDivElement>(null);
  // The bar's scroll fade shows only while rows continue under it (S24,
  // Valve's ScrollFade): the widened pane scrolls itself.
  useEffect(() => {
    const bar = barRef.current;
    const scroller = bar?.closest<HTMLElement>(".wowdeck-pane-slot");
    if (!bar || !scroller) {
      return;
    }
    const onScroll = () => bar.toggleAttribute("data-wowdeck-scrolled", scroller.scrollTop > 0);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <>
      {/* Navigation floats at the top of the pane (S24): the pill bar, and
          under it the Ledger's filters. */}
      <div ref={barRef} className="wowdeck-pane-bar">
        <PanelSectionRow>
          <FocusSlot view={browseFocusView("tsm")} id={TSM_PILL_BAR}>
            <PillBar
              tabs={TSM_VIEWS}
              activeId={view}
              onSelect={(id) => tsmView.set(id as TsmView)}
            />
          </FocusSlot>
        </PanelSectionRow>
        {view === "ledger" && installationId && (
          <TsmLedgerFilters key={installationId} installationId={installationId} />
        )}
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

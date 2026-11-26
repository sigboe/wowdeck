import { useEffect, useRef, useSyncExternalStore } from "react";
import { ButtonItem, PanelSectionRow } from "@decky/ui";
import { browseFocusView, browseZone } from "../browseSessionState";
import { PENDING_RESTORE_MS } from "../focusMemory";
import { TSM_VIEWS, tsmView, type TsmView } from "../tsmView";
import { FocusSlot } from "./FocusSlot";
import { PillBar } from "./TopNav";
import { TsmAddon } from "./TsmAddon";
import { TsmDashboard } from "./TsmDashboard";
import { takeLedgerResume, TsmLedger } from "./TsmLedger";

/**
 * The pill bar's focus-memory key in the destination's browse view. Its
 * pill reports there on focus, so GetAddonsTab's pane Left handling knows
 * the bar has focus and returns Left from the first pill to the list.
 */
export const TSM_PILL_BAR = "pill-bar";

/**
 * Where entering the destination puts focus: its first content row, never
 * the floating title row and its pills, as every other destination lands
 * on its content.
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
 * content row, or, back from Wowhead, the Ledger item opened there
 * (takeLedgerResume). A view still reading has no such row yet (a first
 * read shows only a loading line under its bar), so focus stays on the
 * list until the row appears, for PENDING_RESTORE_MS, unless the player
 * moves first or leaves the pane. Without the wait, focus stayed on the
 * list while the pane counted itself focused. An item that never shows
 * gives way to the first content row then.
 */
export function focusTsmEntry(pane: HTMLElement): void {
  const resumed = takeLedgerResume();
  const find = resumed ?? firstTsmControl;
  const row = find(pane);
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
    const found = find(pane);
    if (!waiting() || found) {
      stop();
    }
    if (found && waiting()) {
      // After the commit, once Steam has registered the row (guide G7).
      win.setTimeout(() => waiting() && found.focus(), 0);
    }
  });
  const timer = win.setTimeout(() => {
    stop();
    const first = resumed && waiting() ? firstTsmControl(pane) : null;
    first?.focus();
  }, PENDING_RESTORE_MS);
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
 * The TradeSkillMaster destination (GLOSSARY): a pill bar over its three
 * views. Auction data is today's pane (or, signed out, the way back to
 * signing in); the Dashboard and the Ledger read the addon's own records
 * and work signed out. The view picked last stays for the session
 * (tsmView).
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
  // Valve's ScrollFade): the widened pane scrolls itself. Its height is
  // where the Ledger's column header sticks (--wowdeck-pane-bar-height).
  useEffect(() => {
    const bar = barRef.current;
    const scroller = bar?.closest<HTMLElement>(".wowdeck-pane-slot");
    if (!bar || !scroller) {
      return;
    }
    const onScroll = () => bar.toggleAttribute("data-wowdeck-scrolled", scroller.scrollTop > 0);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    const measure = () =>
      scroller.style.setProperty("--wowdeck-pane-bar-height", `${bar.offsetHeight}px`);
    measure();
    const win = scroller.ownerDocument.defaultView;
    const resize = win?.ResizeObserver ? new win.ResizeObserver(measure) : null;
    resize?.observe(bar);
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      resize?.disconnect();
      scroller.style.removeProperty("--wowdeck-pane-bar-height");
    };
  }, []);
  return (
    <>
      {/* The title row floats at the top of the pane (S24): the destination's
          name, and its views' pills right-aligned beside it (owner, PR #318
          review). Only the Ledger's column header floats besides it; the
          filters scroll with the rows. */}
      <div ref={barRef} className="wowdeck-pane-bar">
        <PanelSectionRow>
          <div className="wowdeck-pane-title">
            <span>TradeSkillMaster</span>
            <FocusSlot view={browseFocusView("tsm")} id={TSM_PILL_BAR}>
              <PillBar
                tabs={TSM_VIEWS}
                activeId={view}
                onSelect={(id) => tsmView.set(id as TsmView)}
              />
            </FocusSlot>
          </div>
        </PanelSectionRow>
      </div>
      {view === "dashboard" ? (
        installationId && <TsmDashboard key={installationId} installationId={installationId} />
      ) : view === "ledger" ? (
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

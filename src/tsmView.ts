/**
 * The TradeSkillMaster destination's view (pill bar): Auction data first,
 * then the one picked last, for as long as the plugin runs. Dashboard and
 * Ledger carry the names of the addon's own tabs in game (owner, PR #318
 * review). Module scope (P6): it survives tab switches, modal round-trips
 * and the QAM closing.
 */
export type TsmView = "auction" | "dashboard" | "ledger";

export const TSM_VIEWS: { id: TsmView; label: string }[] = [
  { id: "auction", label: "Auction data" },
  { id: "dashboard", label: "Dashboard" },
  { id: "ledger", label: "Ledger" },
];

let current: TsmView = "auction";
const listeners = new Set<() => void>();

export const tsmView = {
  get: (): TsmView => current,
  set(view: TsmView): void {
    if (view === current) return;
    current = view;
    for (const listener of [...listeners]) listener();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** Back to Auction data (tests). */
export function resetTsmView(): void {
  tsmView.set("auction");
}

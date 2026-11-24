import type {
  TradeSkillMasterLedger,
  TradeSkillMasterLedgerPeriod,
} from "../backend/src/api/contracts";

/**
 * What the Ledger's filter bar asks the engine for, per installation. Null
 * is All (realms, characters); an absent account is the engine's pick.
 * Module scope (P6): it survives tab switches, modal round-trips and the
 * QAM closing.
 */
export interface LedgerFilters {
  account?: string;
  realm: string | null;
  character: string | null;
  period: TradeSkillMasterLedgerPeriod;
}

const ALL: LedgerFilters = Object.freeze({ realm: null, character: null, period: "All" });
const byInstallation = new Map<string, LedgerFilters>();
const listeners = new Set<() => void>();

export const ledgerFilters = {
  /** The same object until it changes (useSyncExternalStore). */
  get: (installationId: string): LedgerFilters => byInstallation.get(installationId) ?? ALL,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/**
 * A filter picked in the bar. The next request starts from the bar's own
 * selection, so a pick made before the last one's answer arrives builds on
 * it; a filter the engine dropped is already gone from it
 * (settleLedgerFilters). The account is the shown one until the bar picks
 * one. Another account resets Realm to All and keeps Character; the engine
 * keeps it only if that account has it.
 */
export function pickLedgerFilter(
  installationId: string,
  shown: Pick<TradeSkillMasterLedger, "account">,
  pick: Partial<Omit<LedgerFilters, "account">> | { account: string },
): void {
  const current = ledgerFilters.get(installationId);
  const account = current.account ?? shown.account ?? undefined;
  const next: LedgerFilters = {
    ...current,
    ...(account !== undefined ? { account } : {}),
    ...pick,
  };
  if ("account" in pick && pick.account !== account) {
    next.realm = null;
  }
  byInstallation.set(installationId, next);
  for (const listener of [...listeners]) listener();
}

/**
 * An answer for `asked` arrived: when the engine dropped a realm or
 * character there (it is not a choice), and the bar still asks for `asked`,
 * the bar asks for what was shown instead, so the dropped filter never comes
 * back by itself on a later read. Returns the settled selection, or null
 * when nothing changed. The account stays as asked: an absent one is the
 * engine's pick on every read.
 */
export function settleLedgerFilters(
  installationId: string,
  asked: LedgerFilters,
  shown: Pick<TradeSkillMasterLedger, "realm" | "character">,
): LedgerFilters | null {
  const current = ledgerFilters.get(installationId);
  const same = (a: LedgerFilters, b: LedgerFilters) =>
    a.account === b.account &&
    a.realm === b.realm &&
    a.character === b.character &&
    a.period === b.period;
  if (
    (asked.realm === shown.realm && asked.character === shown.character) ||
    !same(current, asked)
  ) {
    return null;
  }
  const settled = { ...current, realm: shown.realm, character: shown.character };
  byInstallation.set(installationId, settled);
  for (const listener of [...listeners]) listener();
  return settled;
}

/** The engine's params for a selection: All is an absent filter. */
export function ledgerParams(filters: LedgerFilters) {
  return {
    ...(filters.account !== undefined ? { account: filters.account } : {}),
    ...(filters.realm !== null ? { realm: filters.realm } : {}),
    ...(filters.character !== null ? { character: filters.character } : {}),
    period: filters.period,
  };
}

/** Every installation back to All (tests). */
export function resetLedgerFilters(): void {
  byInstallation.clear();
  for (const listener of [...listeners]) listener();
}

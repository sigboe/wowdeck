import type { Installation, SteamGameLink } from "../backend/src/api/contracts";
import type { SteamGame } from "./steamLibrary";

/** Account-scoped path evidence is a preference only, never mutation scope proof. */
export function layoutTargets(
  games: SteamGame[],
  active: Pick<Installation, "steamGames"> | undefined,
  accountId: number | undefined,
) {
  const linked = (active?.steamGames ?? []).filter(
    (link: SteamGameLink) =>
      accountId !== undefined &&
      link.accountId === accountId &&
      games.some((g) => g.appId === link.appId && g.name === link.name),
  );
  const ids = new Set(linked.map((g) => g.appId));
  return { preferred: ids.size === 1 ? games.find((g) => ids.has(g.appId)) : undefined, games };
}
/** Name equality establishes a warning group, never the full affected scope. */
export function possibleSharedTargets(games: SteamGame[], target: number) {
  const selected = games.find((g) => g.appId === target);
  return selected ? games.filter((g) => g.name === selected.name) : [];
}

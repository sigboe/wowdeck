import type { Installation, PluginSettings, SteamGameLink } from "../backend/src/api/contracts";
import { isLikelyWow, linkedSteamGames, type SteamGame } from "./steamLibrary";
import { createStore } from "./store";

/**
 * The entries the layout target dropdown offers (GLOSSARY: Layout target).
 * First the linked entries, by the rule the game page and the home badge use
 * (`linkedSteamGames`): the hand-set link from Options, plus the selected
 * installation's detected links while "Link detected Steam games" is on.
 * Detected links count only for the Steam account signed in now; with the
 * account unknown, none do. Entries come from Steam's library, A–Z, under
 * the names it shows; a link whose app id is no longer a shortcut is left out.
 *
 * With nothing linked, `suggested` entries stand in: the ones detection
 * would link with the toggle off, else the shortcuts whose names look like
 * WoW (`isLikelyWow`). Picking one changes no settings. "Other game…" is the
 * dropdown's own last choice, not one of these.
 *
 * The default: the hand-set link, then an entry seen launching this
 * installation (a proven link), then the only entry detected from its
 * Wine prefix, then the first A–Z. Among suggestions, a proven link first.
 */
export function layoutTargetChoices(
  games: SteamGame[],
  settings: Pick<PluginSettings, "steamGame" | "steamAutoLink">,
  active: Pick<Installation, "steamGames"> | undefined,
  accountId: number | undefined,
): { choices: SteamGame[]; suggested: boolean; initial: SteamGame | undefined } {
  const detected = (active?.steamGames ?? []).filter(
    (link) => accountId !== undefined && link.accountId === accountId,
  );
  const linked = linkedSteamGames(
    [{ steamGames: detected }],
    settings.steamGame,
    settings.steamAutoLink,
    games,
  );
  const choices = games.filter((g) => linked.some((l) => l.appId === g.appId));
  const listed = (appId: number | undefined) => choices.find((g) => g.appId === appId);
  /** The entries among `of` that a detected link of this installation, passing `which`, names. */
  const detectedAmong = (of: SteamGame[], which: (link: SteamGameLink) => boolean) =>
    of.filter((g) => detected.some((d) => d.appId === g.appId && which(d)));
  const autoLinked = settings.steamAutoLink ? choices : [];
  const pathDetected = detectedAmong(autoLinked, (link) => !isProven(link));
  const initial =
    listed(settings.steamGame?.appId) ??
    detectedAmong(autoLinked, isProven)[0] ??
    (pathDetected.length === 1 ? pathDetected[0] : undefined) ??
    choices[0];
  if (choices.length > 0) return { choices, suggested: false, initial };
  const wouldLink = detectedAmong(games, () => true);
  const suggestions = wouldLink.length > 0 ? wouldLink : games.filter((g) => isLikelyWow(g.name));
  const proven = detectedAmong(suggestions, isProven)[0];
  return { choices: suggestions, suggested: true, initial: proven ?? suggestions[0] };
}

/** A proven link (GLOSSARY): the shortcut was seen launching WoW from the installation. */
function isProven(link: SteamGameLink): boolean {
  return link.provenance === "launch";
}

/**
 * The player's dropdown pick per installation id. Module scope (guide P6):
 * it outlives the QAM closing and destination switches while the plugin
 * stays loaded. A pick the dropdown no longer lists falls back to the
 * default.
 */
const picks = createStore<{ byInstallation: Record<string, number> }>({ byInstallation: {} });
export const layoutTargetPicks = {
  get: picks.get,
  subscribe: picks.subscribe,
  pick: (installationId: string, appId: number) =>
    picks.set({ byInstallation: { ...picks.get().byInstallation, [installationId]: appId } }),
  reset: () => picks.set({ byInstallation: {} }),
};

/** The selected entry: the remembered pick while it is still listed, else the default. */
export function selectedLayoutTarget(
  targets: ReturnType<typeof layoutTargetChoices>,
  installationId: string,
): SteamGame | undefined {
  const picked = layoutTargetPicks.get().byInstallation[installationId];
  return targets.choices.find((g) => g.appId === picked) ?? targets.initial;
}

/**
 * Entries that share the target's controls: Steam keys a shortcut's controls
 * by its lowercased name (LIVE 2026-11-17), so case variants share them.
 * Name equality establishes a warning group, never the full affected scope.
 */
export function possibleSharedTargets(games: SteamGame[], target: number) {
  const selected = games.find((g) => g.appId === target);
  return selected ? games.filter((g) => g.name.toLowerCase() === selected.name.toLowerCase()) : [];
}

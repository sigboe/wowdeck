/**
 * What Get Addons derives from its addon sources: which of them can serve a
 * list and in what order, the browse bar's segments (ADR 0002), the
 * zero-capability screen shown when nothing can serve a destination, From
 * URL's notice for a result whose source is off, and the Options jump's
 * landing row. Derived only from ProviderInfo, which the engine fills from
 * ProviderRegistry.usable().
 *
 * Enablement is Options' business (ADR 0002): nothing here turns a source on
 * or off. The pane's only remnant of provider state is the zero-capability
 * screen (zeroCapabilityScreen), which guides to Options and changes nothing.
 */

import type { ProviderInfo } from "./types";
import type { GetAddonsTab } from "./browseSessionState";
import { PROVIDER_ID, providerDisplayName } from "../backend/src/api/providers";
import { formatList } from "./search";

/** Latest and Popular's sources (ProviderInfo.discovers), CurseForge first: the largest catalog. */
export function discoverSources(providers: ProviderInfo[]): ProviderInfo[] {
  return providers
    .filter((p) => p.discovers)
    .sort((a, b) => Number(b.id === PROVIDER_ID.Curse) - Number(a.id === PROVIDER_ID.Curse));
}

/**
 * The source a list opens on: the first one in use, else the first discover
 * source (with none in use the destination shows the zero-capability screen,
 * never a list); null when there is no discover source at all or the sources
 * haven't loaded.
 */
export function defaultDiscoverSource(providers: ProviderInfo[]): string | null {
  const sources = discoverSources(providers);
  return (sources.find((p) => p.available) ?? sources[0])?.id ?? null;
}

/**
 * The Source menu's sources: the ones in use, CurseForge first. A menu lists
 * only what works — nothing "(off)" or "(not set up)": enablement is Options'
 * business, and with none in use the destinations show the zero-capability
 * screen instead of a picker.
 */
export function validDiscoverSources(providers: ProviderInfo[]): ProviderInfo[] {
  return discoverSources(providers).filter((p) => p.available);
}

/**
 * Whether a list has a source to choose at all: one source in use is no
 * choice, so Latest and Popular show no Source picker; two or more get the
 * one menu.
 */
export function hasSourceChoice(providers: ProviderInfo[]): boolean {
  return validDiscoverSources(providers).length > 1;
}

/** One of the browse bar's segments (glossary): Source or Category. */
export type BrowseBarItem = "source" | "category";

/**
 * The browse bar's per-destination item registry (ADR 0002): the segments a
 * destination's bar can ever have, in the bar's fixed order — Source left,
 * Category beside it. Search and From URL have no bar. Which of a
 * destination's segments exist right now is `browseBarItems`' decision; the
 * registry itself never branches.
 */
export const BROWSE_BAR_ITEMS: Record<GetAddonsTab, readonly BrowseBarItem[]> = {
  search: [],
  url: [],
  latest: ["source"],
  popular: ["source", "category"],
};

/**
 * The browse bar's items for a destination: its registry's segments that the
 * loaded sources can act on, in the fixed order. The Source segment needs a
 * source choice (one in use is no choice); the Category segment needs a
 * source in use at all (cached categories must not outlive the source that
 * answered them, or Popular would show a category menu above the
 * zero-capability screen) and the active source's category answer non-empty —
 * capability, never a provider's name. A segment absent here is not rendered,
 * so its neighbours close up to the left, and with none left there is no bar
 * at all.
 */
export function browseBarItems(
  destination: GetAddonsTab,
  providers: ProviderInfo[],
  /** Whether the active source's category lookup answered with categories. */
  sourceHasCategories: boolean,
): readonly BrowseBarItem[] {
  return BROWSE_BAR_ITEMS[destination].filter((item) =>
    item === "source"
      ? hasSourceChoice(providers)
      : sourceHasCategories && validDiscoverSources(providers).length > 0,
  );
}

/**
 * Latest and Popular's row note when no source of theirs is in use; null when
 * one is (or the list hasn't loaded). Generic on purpose: the screen the row
 * opens names every source that can serve the list, so naming one here would
 * contradict it.
 */
export function destinationNote(providers: ProviderInfo[]): string | null {
  const sources = discoverSources(providers);
  return sources.length > 0 && !sources.some((p) => p.available) ? "Needs an addon source" : null;
}

/**
 * An addon looked up From URL whose source is turned off installs (Install
 * from URL works with the source off, as upstream) but is never checked for
 * updates until the source is on again: say so before the install, not after.
 */
export function sourceOffNotice(providers: ProviderInfo[], providerId: string): string | null {
  const p = providers.find((x) => x.id === providerId);
  if (!p || p.available || !p.allowEdit || !p.configured) {
    return null;
  }
  return `${providerDisplayName(providerId)} is turned off: this addon installs, but won't get updates until you turn it on.`;
}

/** Options' toggle description for a source that is off, when turning it on unlocks features. */
export function sourceOffDescription(providerId: string): string | null {
  switch (providerId) {
    case PROVIDER_ID.Curse:
      return "Turn on for the largest addon catalog, with categories";
    case PROVIDER_ID.WowUpHub:
      return "Turn on to search and browse addons published on GitHub";
    default:
      return null;
  }
}

/**
 * The Options jump's landing row (ADR 0002, story 17): the first of the
 * marked providers' rows, in the sources section's own order, that can take
 * focus — the section disables exactly the rows that need setup (a source
 * without its API key), and "find the right toggle immediately" means a
 * toggle that can be pressed. Rows the section never shows (allowEdit
 * false) are not landing rows. Null when no marked row can take focus; the
 * caller's fallback row lands then (the CurseForge key row for "Set up
 * CurseForge", whose toggle is disabled precisely in that state).
 */
export function firstFocusableMarkedSource(
  providers: readonly ProviderInfo[],
  marked: ReadonlySet<string>,
): ProviderInfo | null {
  return (
    providers.find(
      (p) => p.allowEdit && marked.has(p.id) && !(p.requiresApiKey && !p.configured),
    ) ?? null
  );
}

/**
 * A Get Addons capability a source either provides or does not: the Latest
 * and Popular lists (`discovers`), or Search by name (`catalogSearch`). The
 * two are the only capabilities the zero-capability screen speaks for.
 */
export type SourceCapability = "latest" | "popular" | "nameSearch";

/** The glyph a zero-capability screen shows: the missing capability, never a brand. */
export type ZeroCapabilityIcon = "latest" | "popular" | "search";

/**
 * The fine print's tone: a plain gap is muted, a gap that needs setup is a
 * warning, and nothing that can serve at all is an error.
 */
export type ZeroCapabilityTone = "muted" | "warning" | "error";

/**
 * A zero-capability screen's whole content (ADR 0002): shown when nothing can
 * serve the capability a destination needs — Latest and Popular with no
 * discover source in use, Search with nothing that searches by name. Icon,
 * tone, copy and the compatible provider ids all derive from ProviderInfo, so
 * the screen component renders and never decides. `marked` is what the
 * screen's button carries to the Options jump: the compatible rows blink;
 * nothing is toggled (story 18).
 */
export interface ZeroCapabilityScreen {
  readonly capability: SourceCapability;
  readonly icon: ZeroCapabilityIcon;
  readonly tone: ZeroCapabilityTone;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly action: string;
  /** The compatible providers' Options rows to mark; never changed by the jump. */
  readonly marked: readonly string[];
}

/**
 * The capability-specific copy, and its test of who can serve it. One shared
 * derivation (`zeroCapabilityScreen`) reads this table, so both capabilities
 * take the same path and differ only in words and glyph (each destination
 * keeps its own glyph and copy) — never in logic.
 */
interface CapabilityScreenCopy {
  readonly icon: ZeroCapabilityIcon;
  /** What the destination needs, in the player's words. */
  readonly need: string;
  /** What a compatible source can do: "list the newest addons", "search by name". */
  readonly serve: string;
  /** Nothing in the engine can serve this capability. */
  readonly missingTitle: string;
  readonly missingBody: string;
  /** Compatible sources exist, but none is in use. */
  readonly gapTitle: string;
  /** Compatible sources exist, but every one needs setup first. */
  readonly setupTitle: string;
  readonly serves: (provider: ProviderInfo) => boolean;
}

const CAPABILITY_SCREEN_COPY: Record<SourceCapability, CapabilityScreenCopy> = {
  latest: {
    icon: "latest",
    need: "Latest needs an addon source.",
    serve: "list the newest addons",
    missingTitle: "No addon source can list the newest addons",
    missingBody: "This plugin has no addon source that can serve Latest.",
    gapTitle: "No addon source is on for Latest",
    setupTitle: "Latest needs a source set up",
    serves: (p) => p.discovers,
  },
  popular: {
    icon: "popular",
    need: "Popular needs an addon source.",
    serve: "rank the most popular addons",
    missingTitle: "No addon source can rank popular addons",
    missingBody: "This plugin has no addon source that can serve Popular.",
    gapTitle: "No addon source is on for Popular",
    setupTitle: "Popular needs a source set up",
    serves: (p) => p.discovers,
  },
  nameSearch: {
    icon: "search",
    need: "Search needs a source that searches by name.",
    serve: "search by name",
    missingTitle: "No source can search by name",
    missingBody: "This plugin has no source that searches by name.",
    gapTitle: "No source that searches by name is on",
    setupTitle: "Search needs a source set up",
    serves: (p) => p.catalogSearch,
  },
};

/**
 * The zero-capability screen for `capability`, or null when one compatible
 * source is in use (the destination then shows its own UI, never the screen).
 * Derived from capability flags and access states only — no provider name is
 * checked and none is hardcoded; the compatible sources are named from the
 * engine's display names, so a new provider appears correctly without UI
 * changes (story 27).
 *
 * The copy names every source that can serve the capability, because enabling
 * any one of them fixes the player (story 15), and says which still need
 * setting up rather than offering to change a setting from the pane (stories
 * 14, 18). Nothing compatible at all is the one dead end, and says so.
 */
export function zeroCapabilityScreen(
  capability: SourceCapability,
  providers: ProviderInfo[],
): ZeroCapabilityScreen | null {
  const copy = CAPABILITY_SCREEN_COPY[capability];
  const compatible = providers.filter(copy.serves);
  if (compatible.some((p) => p.available)) {
    return null;
  }

  const marked = compatible.map((p) => p.id);
  if (compatible.length === 0) {
    return {
      capability,
      icon: copy.icon,
      tone: "error",
      title: copy.missingTitle,
      body: copy.missingBody,
      status: "Options › Addon sources lists the sources this plugin has.",
      action: "Open addon sources",
      marked,
    };
  }

  const names = compatible.map((p) => providerDisplayName(p.id));
  const turnable = compatible.filter((p) => p.configured).map((p) => providerDisplayName(p.id));
  const needsSetup = compatible.filter((p) => !p.configured).map((p) => providerDisplayName(p.id));

  if (turnable.length === 0) {
    return {
      capability,
      icon: copy.icon,
      tone: "warning",
      title: copy.setupTitle,
      body: `${formatList(names)} ${names.length === 1 ? "needs" : "need"} an API key before ${names.length === 1 ? "it" : "they"} can ${copy.serve}.`,
      status: "Set the key in Options, then turn the source on.",
      action: names.length === 1 ? `Set up ${names[0]}` : "Set up addon sources",
      marked,
    };
  }

  const turnOn = turnable.length === 1 ? "Turn it on" : "Turn one on";
  const setup = needsSetup.length > 0 ? `, or set up ${formatList(needsSetup)}` : "";
  return {
    capability,
    icon: copy.icon,
    tone: needsSetup.length > 0 ? "warning" : "muted",
    title: copy.gapTitle,
    body: `${copy.need} ${formatList(turnable)} can ${copy.serve}. ${turnOn}${setup}.`,
    status: "You can turn sources on or off anytime in Options › Addon sources.",
    action: "Open addon sources",
    marked,
  };
}

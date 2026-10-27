import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { FaClock, FaFileArchive, FaFire, FaSearch } from "react-icons/fa";
import {
  DropdownItem,
  Field,
  Focusable,
  GamepadButton,
  PanelSection,
  PanelSectionRow,
  type GamepadEvent,
} from "@decky/ui";
import type { Installation, ProviderInfo } from "../types";
import * as api from "../services/backend";
import {
  BROWSE_TABS,
  browseFocusView,
  browseZone,
  enterBrowsePane,
  enterBrowseSession,
  focusDestination,
  pageState,
  popBrowseToList,
  popBrowseToNav,
  showWithoutClosing,
  subscribeWidening,
  type GetAddonsTab,
  widening,
} from "../browseSessionState";
import {
  latestDestination,
  listDestination,
  type ListDestinationId,
  popularDestination,
  setCategory as showCategory,
  setSource,
} from "../browseDestinations";
import { loadCategories, loadSources, sourcesStore } from "../sourcesStore";
import {
  attachQamWidening,
  detachQamWidening,
  qamWideningStatus,
  subscribeQamLayout,
} from "../steamDom/qamWidening";
import { isVirtualKeyboardShowing } from "../steamDom/qamVisibility";
import { forgetFocus, rememberFocus, rememberedFocus, restoreFocus } from "../focusMemory";
import { ListTab, ManualInstallTab, SearchTab, type SourceControls } from "./browseTabs";
import { CapabilityGate } from "./ZeroCapabilityScreen";
import { BrowseBar, SEGMENT_FOCUS, segmentOfFocusKey } from "./BrowseBar";
import { destinationNote, validDiscoverSources } from "../sourceAccess";
import { QAM_DROPDOWN_BELOW_VALUE } from "./dropdownValue";
import { descriptionStyle } from "../steamTheme";

/**
 * Get Addons inside the QAM, mapped the way Steam maps Friends & Chat: a
 * collapsed destination list (Search, Latest, Popular, Manual Install)
 * beside a pane that holds the selected destination's browse UI. Focusing a
 * destination slides the QAM out (no press) and swaps the pane; the pane is
 * the one browse code path (browseTabs.tsx). The destination list replaces
 * the old text-tab nav bar, and addon details stay in the details modal.
 */

const DESTINATIONS: Record<GetAddonsTab, { label: string; icon: ReactNode }> = {
  search: { label: "Search", icon: <FaSearch /> },
  latest: { label: "Latest", icon: <FaClock /> },
  popular: { label: "Popular", icon: <FaFire /> },
  // Rebranded, not new: the internal id stays "url" so focus memory and the
  // widened-session state survive the rename (spec: install-from-file).
  url: { label: "Manual Install", icon: <FaFileArchive /> },
};

/** Before the first load: a stable empty list, so the sources' derivations don't re-run. */
const NO_PROVIDERS: ProviderInfo[] = [];

export function GetAddonsTab({
  installations,
  selectedId,
  onSelectInstallation,
  landOnInstallation = false,
  onExitToNav,
  onOpenSources,
}: {
  installations: Installation[];
  selectedId: string | null;
  onSelectInstallation: (id: string) => Promise<void>;
  /**
   * Fresh entry by L1/R1 (PC-04): focus lands on the Installation row, not a
   * destination, so the QAM stays collapsed until a destination gets focus.
   * Read once at mount.
   */
  landOnInstallation?: boolean;
  /** Put focus on the plugin-tab nav bar (B out of the widened session). */
  onExitToNav: () => void;
  /**
   * Open Options' Addon sources section, marking these provider ids (the
   * zero-capability screen's button). Nothing is enabled: the jump only
   * navigates and blink-highlights.
   */
  onOpenSources: (providers: ProviderInfo[], marked: readonly string[]) => void;
}) {
  const listZoneAnchor = useRef<HTMLDivElement>(null);
  const installationRef = useRef<HTMLDivElement>(null);
  const [landingOnInstallation] = useState(landOnInstallation);
  const paneRef = useRef<HTMLDivElement>(null);
  // The destination rows, so Left out of the pane can put focus back on the
  // highlighted one (Steam's own back navigation did not).
  const destinationRefs = useRef<Partial<Record<GetAddonsTab, HTMLDivElement>>>({});
  // Widened mode, mirrored from module state the way every module-scope store
  // here is mirrored: the pane renders from the machine's wanted mode AND the
  // service's availability — with a missing mechanism everything silently
  // stays collapsed (fallback).
  const [wideWanted, setWideWanted] = useState(widening.wide);
  const [wideningAvailable, setWideningAvailable] = useState(false);
  // The layout the QAM page actually has (the service's applied DOM). The
  // widened layout is drawn from this, not from `wide`: on a collapse the mode
  // drops at once, but the pane must stay beside the list until the QAM has
  // slid back over it (PC-08), or the slide would carry an empty strip.
  const [layoutWide, setLayoutWide] = useState(() => qamWideningStatus().applied);
  // The destination whose browse UI the pane shows. Focus is the only thing
  // that changes it (no press), and it is mirrored from the session so a
  // modal round-trip (G4) comes back on the same destination.
  const [active, setActive] = useState<GetAddonsTab>(pageState.tab);
  // Whether focus is in the pane rather than the destination list. Local (not
  // the module zone) because it only drives the destination's selected style,
  // and `enterBrowsePane` alone does not re-render (widened mode is unchanged).
  const [paneFocused, setPaneFocused] = useState(false);

  useEffect(() => {
    const resumed = enterBrowseSession();
    if (resumed === "list") {
      // Back from the Install into menu while widened: its row is the only
      // thing in the list that opens one.
      setTimeout(() => {
        const slot = installationRef.current;
        (slot?.querySelector<HTMLElement>(".Focusable[tabindex]") ?? slot)?.focus();
      }, 0);
    } else if (resumed === "pane") {
      // Back from the details carousel (or a menu) opened in the pane: the
      // widened QAM never closed, so focus returns to the row it was on.
      setPaneFocused(true);
      const tab = pageState.tab;
      const view = browseFocusView(tab);
      setTimeout(() => {
        // restoreFocus also waits for a row that has not mounted yet.
        if (rememberedFocus(view) !== undefined) {
          restoreFocus(view);
        } else {
          firstPaneControl(tab)?.focus();
        }
      }, 0);
    }
    const anchor = listZoneAnchor.current;
    setWideningAvailable(anchor ? attachQamWidening(anchor) : false);
    const stopWidening = subscribeWidening(setWideWanted);
    const stopLayout = subscribeQamLayout(setLayoutWide);
    setLayoutWide(qamWideningStatus().applied);
    return () => {
      stopWidening();
      stopLayout();
      // Detach (not stop): the wanted mode survives the modal round-trips the
      // panel unmounts for (G4); re-mounting re-attaches with a fresh anchor
      // and the service re-derives the DOM from it.
      detachQamWidening();
    };
  }, []);

  // The sources as last loaded (sourcesStore), so a remount (every dropdown
  // menu, G4) renders the bar and its list at once instead of an empty pane
  // that focus falls out of; read again on every mount. The lists' picks
  // follow them in browseDestinations.ts.
  const {
    providers: loadedProviders,
    loaded: providersLoaded,
    categories: categoriesBySource,
  } = useSyncExternalStore(sourcesStore.subscribe, sourcesStore.get);
  const providers = loadedProviders ?? NO_PROVIDERS;
  useEffect(() => {
    void loadSources(api.rpc);
  }, []);
  const { categoryId, sourceId: popularSource } = useSyncExternalStore(
    popularDestination.subscribe,
    popularDestination.get,
  );
  const { sourceId: latestSource } = useSyncExternalStore(
    latestDestination.subscribe,
    latestDestination.get,
  );
  /** Another source in the bar's Source segment: the list starts over, and so does its place. */
  const pickSource = (tab: ListDestinationId, id: string) => {
    if (id === listDestination(tab).get().sourceId) {
      return;
    }
    setSource(tab, id);
    forgetFocus(browseFocusView(tab));
    // The pick changed the list, not the bar: drop the stale row memory (the
    // list it remembered is gone) and remember the segment instead, so pane
    // re-entry and Left handling work from the bar (BrowseBar). The menu
    // itself puts focus back on the button when it closes.
    rememberFocus(browseFocusView(tab), SEGMENT_FOCUS.source);
  };

  // The browse bar's Category segment needs the active source's categories,
  // and only the answer says whether it has any (capability, never a
  // provider's name — ADR 0002): a lookup per Popular source, kept in the
  // sources store and asked for once. Only a source the bar still offers is
  // asked: with every source off there is no list to narrow.
  useEffect(() => {
    if (popularSource && validDiscoverSources(providers).some((p) => p.id === popularSource)) {
      void loadCategories(api.rpc, popularSource);
    }
  }, [popularSource, providers]);

  const installation = installations.find((i) => i.id === selectedId) ?? null;

  // Remount the tab bodies when the installation changes: the kept lists
  // belong to the previous installation (reset by Content's switch handler).
  const [listVersion, setListVersion] = useState(0);
  const prevSelectedId = useRef(selectedId);
  useEffect(() => {
    if (prevSelectedId.current !== selectedId) {
      prevSelectedId.current = selectedId;
      setListVersion((v) => v + 1);
    }
  }, [selectedId]);

  const setCategory = (id: string | null) => {
    if (id === categoryId) {
      return;
    }
    showCategory(id);
    // The remembered row went with the old list; remember the segment that
    // narrowed it instead (like pickSource above).
    forgetFocus(browseFocusView("popular"));
    rememberFocus(browseFocusView("popular"), SEGMENT_FOCUS.category);
  };

  const wide = wideWanted && wideningAvailable;

  // preferredFocus alone decides only where Steam enters the subtree; the
  // previous tab's focused row unmounting may already have moved focus, so
  // focus the row explicitly once Steam has registered it (guide G7).
  useEffect(() => {
    if (!landingOnInstallation) {
      return;
    }
    const timer = setTimeout(() => {
      const slot = installationRef.current;
      (slot?.querySelector<HTMLElement>(".Focusable[tabindex]") ?? slot)?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  /**
   * The first thing focus should land on in a destination's pane. For the list
   * destinations that is the first addon row, not the browse bar above it
   * (owner): the picker stayed the steam-right target and felt wrong. Search
   * and From URL start on their own first control (the text field).
   */
  const firstPaneControl = (tab: GetAddonsTab): HTMLElement | null => {
    const pane = paneRef.current;
    if (!pane) {
      return null;
    }
    // The first match that can take focus: Steam's DialogButton says it is
    // disabled by a class, not the attribute.
    const first = (selector: string) =>
      [...pane.querySelectorAll<HTMLElement>(selector)].find(
        (e) => !(e as HTMLInputElement).disabled && !e.classList.contains("Disabled"),
      ) ?? null;
    if (tab === "latest" || tab === "popular") {
      const row = first(".wowdeck-result-row");
      if (row) {
        return row;
      }
    }
    // Search and Manual Install's link row: the text input itself. Steam's
    // first `.Focusable` there is a wrapper, so landing on it took two
    // rights to reach the field (owner). With nothing to search, Search
    // shows the zero-capability screen, whose button is then the sensible
    // landing; then anything else that takes focus.
    return (
      first("input, textarea") ??
      first(".wowdeck-zero-capability button") ??
      first("button.Focusable, .Focusable[tabindex]")
    );
  };

  /**
   * A/Enter on a destination, Moving focus into the pane (steam-right, caught
   * below): focus the destination's first control. The pane only exists while
   * wide, which destination focus has already established; the timeout lets
   * Steam register the new node in its navigation tree (guide G7).
   */
  const focusPane = (tab: GetAddonsTab = active) => {
    setPaneFocused(true);
    enterBrowsePane();
    const view = browseFocusView(tab);
    setTimeout(() => {
      // Re-entering a list returns to the row you left on (owner's "doesn't
      // remember our place"); a first visit, or a list reset since, falls back
      // to its first item rather than the browse bar. Search and From URL
      // land on their field (their rows are remembered for round-trips only).
      if ((tab === "latest" || tab === "popular") && restoreFocus(view)) {
        return;
      }
      firstPaneControl(tab)?.focus();
    }, 0);
  };

  /** A/Enter or a click on a destination: select it, widen, then enter its pane. */
  const openDestination = (tab: GetAddonsTab) => {
    setActive(tab);
    focusDestination(tab);
    focusPane(tab);
  };

  /**
   * B from the pane or the destination list slides the QAM closed and puts
   * focus on the plugin-tab nav bar (spec stories 8 and 10). Steam's own back
   * navigation is not used: from the pane it lands on the destination row,
   * which widens again (DEVICE 2026-10-20), and from the list on Decky's back
   * button.
   */
  const onContentButtonDown = (evt: GamepadEvent) => {
    const button = evt.detail.button;
    const inPane = browseZone.zone === "pane";
    // Left in the pane returns to the destination that opened it, still widened
    // (the two columns are one surface). Text fields keep Left for caret
    // movement, and the browse bar keeps it for its own row: Left from a
    // segment that has one to its left (Category) moves to that segment —
    // Steam's own navigation skips the sibling segment and leaves the pane
    // (DEVICE 2026-10-23) — so only Left from the bar's first segment, or
    // from anywhere else in the pane, returns to the destination list.
    // Which control has focus is read from the focus memory, not the DOM:
    // every pane control reports there on focus, and Steam has already
    // cleared DOM focus (`.gpfocus`, `activeElement`) by the time the button
    // event reaches us (DEVICE 2026-10-23).
    if (button === GamepadButton.DIR_LEFT && inPane) {
      const focused =
        (document.querySelector(".gpfocus") as HTMLElement | null) ?? document.activeElement;
      if (
        focused instanceof HTMLElement &&
        (focused.tagName === "INPUT" || focused.tagName === "TEXTAREA" || focused.isContentEditable)
      ) {
        return;
      }
      const segment = segmentOfFocusKey(rememberedFocus(browseFocusView(active)));
      if (segment === "category") {
        // Category is never the bar's first segment; Left from it is the bar's
        // own row movement. (With only a Category segment there is no Source
        // segment to find, and Left falls through to the destination list.)
        const target = paneRef.current?.querySelector<HTMLElement>(
          '[data-wowdeck-segment="source"] button.Focusable:not(:disabled)',
        );
        if (target) {
          evt.preventDefault();
          evt.stopPropagation();
          target.focus();
          return;
        }
      }
      evt.preventDefault();
      evt.stopPropagation();
      popBrowseToList();
      setPaneFocused(false);
      destinationRefs.current[active]?.focus();
      return;
    }
    // Steam-right from the destination list enters the pane on its first item
    // (the browse bar is not the target; owner). Caught here so the target
    // is ours, not Steam's first-focusable pick.
    if (button === GamepadButton.DIR_RIGHT && wideningAvailable && browseZone.zone === "list") {
      evt.preventDefault();
      evt.stopPropagation();
      focusPane(active);
      return;
    }
    // Left out of the destination list leaves the plugin content for the QAM
    // icon rail (the Decky tab): close the widened QAM so it is not left open
    // behind the rail. The event is not stopped, so Steam still moves focus
    // out to the rail.
    if (button === GamepadButton.DIR_LEFT) {
      popBrowseToNav();
      return;
    }
    if (button !== GamepadButton.CANCEL) {
      return;
    }
    // B with the on-screen keyboard up closes the keyboard (Steam's own
    // handling), not the pane.
    if (isVirtualKeyboardShowing()) {
      return;
    }
    const inSession = inPane || browseZone.zone === "list";
    setPaneFocused(false);
    popBrowseToNav();
    if (inSession) {
      evt.preventDefault();
      evt.stopPropagation();
      onExitToNav();
    }
  };

  const sources: SourceControls = {
    providers,
    loaded: providersLoaded,
    openSources: (marked) => onOpenSources(providers, marked),
  };

  const tabBody = (tab: GetAddonsTab): ReactNode => {
    switch (tab) {
      case "search":
        return <SearchTab key={`s${listVersion}`} sources={sources} installation={installation} />;
      case "latest":
        return (
          <CapabilityGate
            key={`l${listVersion}`}
            capability="latest"
            providers={providers}
            loaded={providersLoaded}
            onOpenSources={sources.openSources}
          >
            <ListTab
              key={latestSource ?? ""}
              destination="latest"
              view={browseFocusView("latest")}
            />
          </CapabilityGate>
        );
      case "popular":
        return (
          <CapabilityGate
            key={`p${listVersion}`}
            capability="popular"
            providers={providers}
            loaded={providersLoaded}
            onOpenSources={sources.openSources}
          >
            <ListTab
              key={`${popularSource ?? ""}:${categoryId ?? "all"}`}
              destination="popular"
              view={browseFocusView("popular")}
            />
          </CapabilityGate>
        );
      case "url":
        return <ManualInstallTab sources={sources} />;
    }
  };

  const pane = (
    <Focusable
      ref={paneRef}
      flow-children="column"
      onGamepadFocus={() => {
        setPaneFocused(true);
        enterBrowsePane();
      }}
      style={{ minWidth: 0 }}
    >
      <PanelSection>
        {/* The browse bar (ADR 0002): the pane's one picker row, deciding its
            own segments from the destination and the sources — Popular gets
            Source then Category, Latest Source, Search and From URL no bar;
            nothing to choose is no bar at all. */}
        <BrowseBar
          destination={active}
          providers={providers}
          sourceId={active === "latest" ? latestSource : popularSource}
          categoryId={categoryId}
          categories={popularSource ? (categoriesBySource[popularSource] ?? []) : []}
          onSource={(id) => {
            // The Source segment exists only for the list destinations (the
            // registry says so); the pick is the picked list's own.
            if (active === "latest" || active === "popular") {
              pickSource(active, id);
            }
          }}
          onCategory={setCategory}
        />
        {tabBody(active)}
      </PanelSection>
    </Focusable>
  );

  return (
    <Focusable
      ref={listZoneAnchor}
      className="wowdeck-list-zone"
      onButtonDown={onContentButtonDown}
      // Navigation follows the layout: two side-by-side zones when widened
      // (destination list | pane), the vertical destination list alone when
      // collapsed. Without an explicit flow Steam flattens the rows into one
      // row, so left/right walked the vertical destinations (DEVICE).
      flow-children={layoutWide ? "row" : "column"}
      style={layoutWide ? { display: "flex", gap: "16px", alignItems: "stretch" } : undefined}
    >
      {/* The destination list: the Installation picker above it, then the four
          destinations in Steam's row language (icon + label). Kept at the
          collapsed 300 px width when widened so its rows and labels do not
          resize under the user as the pane slides out. */}
      <Focusable
        flow-children="column"
        style={layoutWide ? { width: "300px", flexShrink: 0, minWidth: 0 } : undefined}
      >
        <PanelSection>
          {/* Focusable with one installation too, so L1/R1 lands here the same
              way whatever the count (PC-04). */}
          {(installations.length > 1 || installation) && (
            <PanelSectionRow>
              <Focusable ref={installationRef} preferredFocus={landingOnInstallation}>
                {installations.length > 1 ? (
                  <DropdownItem
                    // No label: the button is the whole row, so a long
                    // installation name has the row's width at the row's
                    // usual height (owner, 2026-10-23); the menu says what it
                    // picks.
                    menuLabel="Installation"
                    rgOptions={installations.map((i) => ({ data: i.id, label: i.displayName }))}
                    selectedOption={selectedId}
                    childrenContainerWidth="max"
                    renderButtonValue={QAM_DROPDOWN_BELOW_VALUE}
                    onChange={(o) => void onSelectInstallation(o.data as string)}
                    onMenuWillOpen={showWithoutClosing}
                    bottomSeparator="none"
                  />
                ) : (
                  <Field
                    focusable
                    label="Installation"
                    description={<span style={descriptionStyle}>{installation!.displayName}</span>}
                  />
                )}
              </Focusable>
            </PanelSectionRow>
          )}
          {BROWSE_TABS.map((tab) => (
            <PanelSectionRow key={tab}>
              <Field
                focusable
                ref={(el) => {
                  destinationRefs.current[tab] = el ?? undefined;
                }}
                className={
                  wide && paneFocused && active === tab ? "wowdeck-destination-selected" : undefined
                }
                icon={DESTINATIONS[tab].icon}
                label={DESTINATIONS[tab].label}
                description={
                  (tab === "latest" || tab === "popular") &&
                  destinationNote(providers) && (
                    <span style={descriptionStyle}>{destinationNote(providers)}</span>
                  )
                }
                onClick={() => openDestination(tab)}
                onOKActionDescription="Open"
                onGamepadFocus={() => {
                  setPaneFocused(false);
                  setActive(tab);
                  focusDestination(tab);
                }}
              />
            </PanelSectionRow>
          ))}
        </PanelSection>
      </Focusable>
      {wideningAvailable ? (
        // The pane is its own persistent slot: because the wrapper element
        // survives widening and collapsing, the widen motion animates from
        // existing DOM state, not a swap.
        <div
          className={`wowdeck-pane-slot${layoutWide ? " wowdeck-pane-slot-open" : ""}`}
          aria-hidden={!wide}
        >
          {layoutWide && pane}
        </div>
      ) : (
        // No widening (a Steam update changed it, story 26): the destination's
        // browse UI sits under the destination list, collapsed but usable.
        pane
      )}
    </Focusable>
  );
}

/// <reference types="bun-types" />
import { beforeEach, describe, expect, test } from "bun:test";
import {
  BROWSE_TABS,
  browseFocusView,
  browseZone,
  enterBrowsePane,
  enterBrowseSession,
  focusDestination,
  leaveBrowseSession,
  pageState,
  popBrowseToList,
  popBrowseToNav,
  resetBrowseSessionState,
  subscribeWidening,
  widening,
} from "./browseSessionState";
import type { BrowseFocusZone } from "./browseSessionState";
import {
  latestDestination,
  popularDestination,
  searchDestination,
  urlDestination,
} from "./browseDestinations";
import { sourcesStore } from "./sourcesStore";
import type { SearchResult } from "./types";

const r = { providerId: "Curse", externalId: "1" } as SearchResult;

beforeEach(() => {
  resetBrowseSessionState();
  leaveBrowseSession();
  pageState.tab = "search";
});

describe("resetBrowseSessionState", () => {
  test("clears loaded lists, the selected category, the search and the looked-up URL", () => {
    latestDestination.patch({ results: [r], totalCount: 9, lastPageSize: 1, loaded: true });
    popularDestination.patch({ results: [r], loaded: true, categoryId: "1019" });
    searchDestination.patch({ query: "details", results: [r] });
    urlDestination.patch({ url: "owner/repo", resolved: r });

    resetBrowseSessionState();

    expect(latestDestination.get()).toMatchObject({
      results: [],
      totalCount: 0,
      lastPageSize: 0,
      loaded: false,
    });
    expect(popularDestination.get()).toMatchObject({
      results: [],
      loaded: false,
      categoryId: null,
    });
    expect(searchDestination.get()).toMatchObject({ query: "", results: null });
    expect(urlDestination.get()).toMatchObject({ url: "", resolved: null });
  });

  test("keeps the cached categories, by source", () => {
    sourcesStore.patch({ categories: { Curse: [{ id: "1019", name: "Combat" }] } });
    resetBrowseSessionState();
    expect(sourcesStore.get().categories).toEqual({ Curse: [{ id: "1019", name: "Combat" }] });
  });

  test("lands the focus zone back on the nav bar", () => {
    browseZone.zone = "pane";
    resetBrowseSessionState();
    expect(browseZone.zone as BrowseFocusZone).toBe("nav");
  });
});

describe("browse session state machine", () => {
  test("the destinations are the four Get Addons entries in list order", () => {
    expect(BROWSE_TABS).toEqual(["search", "latest", "popular", "url"]);
  });

  test("entering Get Addons lands the focus zone on the nav bar", () => {
    browseZone.zone = "list";
    enterBrowseSession();
    expect(browseZone.zone as BrowseFocusZone).toBe("nav");
  });

  test("a remount from the widened pane resumes the pane (details carousel closed)", () => {
    enterBrowsePane();
    expect(enterBrowseSession()).toBe("pane");
    expect(browseZone.zone as BrowseFocusZone).toBe("pane");
    expect(widening.wide).toBe(true);
  });

  test("a remount from the widened list resumes the list (Install into menu closed)", () => {
    focusDestination("latest");
    expect(enterBrowseSession()).toBe("list");
    expect(browseZone.zone as BrowseFocusZone).toBe("list");
    expect(widening.wide).toBe(true);
  });

  test("a remount after leaving is a fresh entry on the nav bar", () => {
    enterBrowsePane();
    leaveBrowseSession();
    expect(enterBrowseSession()).toBeNull();
    expect(browseZone.zone as BrowseFocusZone).toBe("nav");
  });

  test("resetting the session collapses: the nav bar is the collapsed landing", () => {
    focusDestination("popular");
    enterBrowsePane();
    resetBrowseSessionState();
    expect(browseZone.zone as BrowseFocusZone).toBe("nav");
    expect(widening.wide).toBe(false);
  });

  test("entering Get Addons does not touch the wanted width (modal round-trip)", () => {
    focusDestination("latest");
    expect(widening.wide).toBe(true);
    enterBrowseSession();
    expect(widening.wide).toBe(true);
  });

  test("focusing a destination selects it and widens, without a press", () => {
    focusDestination("popular");
    expect(pageState.tab).toBe("popular");
    expect(browseZone.zone as BrowseFocusZone).toBe("list");
    expect(widening.wide).toBe(true);
  });

  test("moving focus between destinations swaps the pane content", () => {
    focusDestination("search");
    focusDestination("latest");
    expect(pageState.tab).toBe("latest");
    expect(widening.wide).toBe(true);
  });

  test("entering the pane keeps the destination and widened mode", () => {
    focusDestination("url");
    enterBrowsePane();
    expect(browseZone.zone as BrowseFocusZone).toBe("pane");
    expect(widening.wide).toBe(true);
    expect(pageState.tab).toBe("url");
  });

  test("B out of the pane collapses and returns the zone to the nav bar", () => {
    focusDestination("latest");
    enterBrowsePane();
    popBrowseToNav();
    expect(browseZone.zone as BrowseFocusZone).toBe("nav");
    expect(widening.wide).toBe(false);
  });

  test("B keeps the selected destination so the list stays where it was", () => {
    focusDestination("popular");
    popBrowseToNav();
    expect(pageState.tab).toBe("popular");
    expect(widening.wide).toBe(false);
  });

  test("Left out of the pane keeps widened mode and returns to the list zone", () => {
    focusDestination("popular");
    enterBrowsePane();
    popBrowseToList();
    expect(browseZone.zone as BrowseFocusZone).toBe("list");
    expect(widening.wide).toBe(true);
    expect(pageState.tab).toBe("popular");
  });

  test("each destination has its own focus-memory view", () => {
    expect(browseFocusView("popular")).toBe("qam.browse.popular");
    expect(new Set(BROWSE_TABS.map(browseFocusView)).size).toBe(BROWSE_TABS.length);
  });

  test("re-focusing a destination after a collapse widens again", () => {
    focusDestination("latest");
    popBrowseToNav();
    focusDestination("latest");
    expect(widening.wide).toBe(true);
  });

  test("leaving the plugin tab collapses and resets the zone", () => {
    focusDestination("latest");
    enterBrowsePane();
    leaveBrowseSession();
    expect(browseZone.zone as BrowseFocusZone).toBe("nav");
    expect(widening.wide).toBe(false);
  });
});

describe("widening subscription", () => {
  test("notifies only when the mode actually changes", () => {
    expect(widening.wide).toBe(false);
    const seen: boolean[] = [];
    const stop = subscribeWidening((wide) => seen.push(wide));

    focusDestination("latest");
    focusDestination("popular");
    enterBrowsePane();
    popBrowseToNav();
    popBrowseToNav();

    stop();
    expect(seen).toEqual([true, false]);
  });

  test("unsubscribing stops notifications", () => {
    const seen: boolean[] = [];
    const stop = subscribeWidening((wide) => seen.push(wide));
    stop();
    focusDestination("latest");
    expect(seen).toEqual([]);
  });
});

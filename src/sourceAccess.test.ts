/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  BROWSE_BAR_ITEMS,
  browseBarItems,
  defaultDiscoverSource,
  destinationNote,
  discoverSources,
  firstFocusableMarkedSource,
  hasSourceChoice,
  sourceOffDescription,
  sourceOffNotice,
  validDiscoverSources,
  zeroCapabilityScreen,
} from "./sourceAccess";
import type { ProviderInfo } from "./types";

function provider(id: string, overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    id,
    name: id,
    enabled: true,
    available: true,
    requiresApiKey: false,
    configured: true,
    allowEdit: true,
    catalogSearch: true,
    discovers: false,
    ...overrides,
  };
}

const curse = (o: Partial<ProviderInfo> = {}) => provider("Curse", { discovers: true, ...o });
const hub = (o: Partial<ProviderInfo> = {}) => provider("WowUpHub", { discovers: true, ...o });
const off = { enabled: false, available: false };

describe("Latest and Popular sources", () => {
  test("CurseForge first, whatever the list order", () => {
    expect(discoverSources([hub(), provider("TukUI"), curse()]).map((p) => p.id)).toEqual([
      "Curse",
      "WowUpHub",
    ]);
  });
  test("opens on CurseForge when in use, else the first in use, else CurseForge", () => {
    expect(defaultDiscoverSource([hub(), curse()])).toBe("Curse");
    expect(defaultDiscoverSource([hub(), curse(off)])).toBe("WowUpHub");
    expect(defaultDiscoverSource([hub(off), curse(off)])).toBe("Curse");
    expect(defaultDiscoverSource([])).toBeNull();
  });
  test("the menu's sources work: nothing off or not set up is listed", () => {
    expect(
      validDiscoverSources([hub(off), curse(), provider("TukUI", { discovers: true })]).map(
        (p) => p.id,
      ),
    ).toEqual(["Curse", "TukUI"]);
    expect(
      validDiscoverSources([curse({ ...off, configured: false }), hub()]).map((p) => p.id),
    ).toEqual(["WowUpHub"]);
    expect(validDiscoverSources([curse(off), hub(off)])).toEqual([]);
  });
  test("one source that works is no choice: no picker; two or more are", () => {
    expect(hasSourceChoice([])).toBe(false);
    expect(hasSourceChoice([curse()])).toBe(false);
    expect(hasSourceChoice([curse(), hub(off)])).toBe(false);
    expect(hasSourceChoice([curse(), hub()])).toBe(true);
  });
});

describe("browseBarItems", () => {
  test("the registry: Popular Source then Category, Latest Source, Search and From URL none", () => {
    expect(BROWSE_BAR_ITEMS).toEqual({
      search: [],
      url: [],
      latest: ["source"],
      popular: ["source", "category"],
    });
  });

  test("Search and From URL have no bar, whatever the sources", () => {
    expect(browseBarItems("search", [curse(), hub()], true)).toEqual([]);
    expect(browseBarItems("url", [curse(), hub()], true)).toEqual([]);
  });

  test("Latest: the Source segment, and only while there is a choice", () => {
    expect(browseBarItems("latest", [curse(), hub()], true)).toEqual(["source"]);
    expect(browseBarItems("latest", [curse()], true)).toEqual([]);
  });

  test("Popular on a category-capable source: Source then Category, in that order", () => {
    expect(browseBarItems("popular", [curse(), hub()], true)).toEqual(["source", "category"]);
  });

  test("Popular with no source choice: the Category segment alone, closed up to the left", () => {
    expect(browseBarItems("popular", [curse()], true)).toEqual(["category"]);
  });

  test("Popular on a source without categories: no Category segment", () => {
    expect(browseBarItems("popular", [curse(), hub()], false)).toEqual(["source"]);
    expect(browseBarItems("popular", [curse()], false)).toEqual([]);
  });

  test("no source in use at all: no bar on any destination, even with cached categories", () => {
    for (const destination of ["search", "latest", "popular", "url"] as const) {
      expect(browseBarItems(destination, [curse(off), hub(off)], true)).toEqual([]);
    }
  });

  test("a segment's fitness is the sources' capability, never a provider's name", () => {
    const source = provider("NewCatalog", { discovers: true });
    expect(browseBarItems("popular", [source], true)).toEqual(["category"]);
    expect(
      browseBarItems("popular", [source, provider("AnotherCatalog", { discovers: true })], true),
    ).toEqual(["source", "category"]);
  });
});

describe("destinationNote", () => {
  test("only while no source of the lists is in use", () => {
    expect(destinationNote([curse(off), hub(off)])).toBe("Needs an addon source");
    expect(destinationNote([curse(off), hub()])).toBeNull();
    expect(destinationNote([curse()])).toBeNull();
    expect(destinationNote([])).toBeNull();
  });
});

describe("sourceOffNotice", () => {
  test("warns for a source turned off", () => {
    const providers = [provider("WowInterface", { enabled: false, available: false })];
    expect(sourceOffNotice(providers, "WowInterface")).toContain("won't get updates");
  });
  test("silent for a source in use, one that can't be toggled, or an unknown one", () => {
    expect(sourceOffNotice([provider("WowInterface")], "WowInterface")).toBeNull();
    expect(
      sourceOffNotice([provider("Zip", { available: false, allowEdit: false })], "Zip"),
    ).toBeNull();
    expect(sourceOffNotice([], "WowInterface")).toBeNull();
  });
});

describe("sourceOffDescription", () => {
  test("names what CurseForge unlocks", () => {
    expect(sourceOffDescription("Curse")).toContain("categories");
    expect(sourceOffDescription("WowUpHub")).toContain("GitHub");
    expect(sourceOffDescription("TukUI")).toBeNull();
  });
});

describe("firstFocusableMarkedSource", () => {
  test("picks the first marked row that can take focus, in the section's order", () => {
    const providers = [provider("Curse"), provider("WowUpHub"), provider("TukUI")];
    expect(firstFocusableMarkedSource(providers, new Set(["TukUI", "WowUpHub"]))?.id).toBe(
      "WowUpHub",
    );
  });
  test("skips a source whose toggle needs setup (no key yet)", () => {
    const providers = [
      provider("Curse", { requiresApiKey: true, configured: false }),
      provider("WowUpHub"),
    ];
    expect(firstFocusableMarkedSource(providers, new Set(["Curse", "WowUpHub"]))?.id).toBe(
      "WowUpHub",
    );
  });
  test("skips a source the section never shows", () => {
    const providers = [provider("Zip", { allowEdit: false }), provider("TukUI")];
    expect(firstFocusableMarkedSource(providers, new Set(["Zip", "TukUI"]))?.id).toBe("TukUI");
  });
  test("null when no marked row can take focus", () => {
    const providers = [
      provider("Curse", { requiresApiKey: true, configured: false }),
      provider("WowUpHub"),
    ];
    expect(firstFocusableMarkedSource(providers, new Set(["Curse"]))).toBeNull();
    expect(firstFocusableMarkedSource(providers, new Set())).toBeNull();
  });
});

describe("zeroCapabilityScreen", () => {
  test("null while a source can serve the capability: the list itself, never the screen", () => {
    expect(zeroCapabilityScreen("latest", [curse(), hub(off)])).toBeNull();
    expect(zeroCapabilityScreen("nameSearch", [provider("TukUI")])).toBeNull();
  });

  test("Latest with every compatible source off: names them and offers the Options jump", () => {
    expect(zeroCapabilityScreen("latest", [curse(off), hub(off)])).toEqual({
      capability: "latest",
      icon: "latest",
      tone: "muted",
      title: "No addon source is on for Latest",
      body: "Latest needs an addon source. CurseForge and WowUp Hub can list the newest addons. Turn one on.",
      status: "You can turn sources on or off anytime in Options › Addon sources.",
      action: "Open addon sources",
      marked: ["Curse", "WowUpHub"],
    });
  });

  test("Popular has its own glyph and words, on the same derivation", () => {
    expect(zeroCapabilityScreen("popular", [curse(off), hub(off)])).toMatchObject({
      capability: "popular",
      icon: "popular",
      title: "No addon source is on for Popular",
      body: "Popular needs an addon source. CurseForge and WowUp Hub can rank the most popular addons. Turn one on.",
      marked: ["Curse", "WowUpHub"],
    });
  });

  test("one compatible source reads naturally and marks only it", () => {
    const screen = zeroCapabilityScreen("latest", [hub(off)])!;
    expect(screen.body).toContain("WowUp Hub can list the newest addons. Turn it on.");
    expect(screen.marked).toEqual(["WowUpHub"]);
  });

  test("a source that needs setup is named as such, with the setup action", () => {
    const setupNeeded = curse({ ...off, requiresApiKey: true, configured: false });
    const screen = zeroCapabilityScreen("latest", [setupNeeded])!;
    expect(screen).toMatchObject({
      tone: "warning",
      title: "Latest needs a source set up",
      action: "Set up CurseForge",
    });
    expect(screen.body).toContain(
      "CurseForge needs an API key before it can list the newest addons",
    );
    expect(screen.status).toContain("Set the key");
  });

  test("mixed off and needs-setup: both ways out, warning tone", () => {
    const screen = zeroCapabilityScreen("latest", [
      curse({ ...off, requiresApiKey: true, configured: false }),
      hub(off),
    ])!;
    expect(screen.tone).toBe("warning");
    expect(screen.body).toContain(
      "WowUp Hub can list the newest addons. Turn it on, or set up CurseForge.",
    );
    expect(screen.marked).toEqual(["Curse", "WowUpHub"]);
  });

  test("Search names only the sources that can search by name", () => {
    const screen = zeroCapabilityScreen("nameSearch", [
      provider("GitHub", { catalogSearch: false }),
      provider("WowInterface", { catalogSearch: false }),
      curse(off),
      hub(off),
    ])!;
    expect(screen).toMatchObject({
      capability: "nameSearch",
      icon: "search",
      tone: "muted",
      title: "No source that searches by name is on",
      action: "Open addon sources",
    });
    expect(screen.body).toContain("CurseForge and WowUp Hub can search by name");
    expect(screen.body).not.toContain("GitHub");
    expect(screen.body).not.toContain("WoWInterface");
    expect(screen.marked).toEqual(["Curse", "WowUpHub"]);
  });

  test("the setup path is shared with name-search, not duplicated", () => {
    const screen = zeroCapabilityScreen("nameSearch", [
      curse({ ...off, requiresApiKey: true, configured: false }),
    ])!;
    expect(screen).toMatchObject({
      icon: "search",
      tone: "warning",
      title: "Search needs a source set up",
      action: "Set up CurseForge",
    });
    expect(screen.body).toContain("before it can search by name");
  });

  test("nothing can serve at all: an error-toned dead end, nothing marked", () => {
    const lists = zeroCapabilityScreen("latest", [provider("TukUI")])!;
    expect(lists).toMatchObject({
      tone: "error",
      icon: "latest",
      title: "No addon source can list the newest addons",
      marked: [],
    });
    const search = zeroCapabilityScreen("nameSearch", [
      provider("GitHub", { catalogSearch: false }),
    ])!;
    expect(search).toMatchObject({
      tone: "error",
      icon: "search",
      title: "No source can search by name",
      marked: [],
    });
  });

  test("capability comes from flags, never a provider's name", () => {
    expect(
      zeroCapabilityScreen("latest", [provider("NewCatalog", { ...off, discovers: true })])!.body,
    ).toContain("NewCatalog can list the newest addons");
    expect(
      zeroCapabilityScreen("nameSearch", [provider("NewSearch", { ...off, catalogSearch: true })])!
        .body,
    ).toContain("NewSearch can search by name");
  });
});

/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  formatList,
  searchHelperText,
  friendlySearchError,
  installationLabel,
  searchOutcome,
} from "./search";
import type { Installation, ProviderInfo } from "./types";

function provider(over: Partial<ProviderInfo> & Pick<ProviderInfo, "id" | "name">): ProviderInfo {
  return {
    enabled: true,
    available: true,
    requiresApiKey: false,
    configured: true,
    allowEdit: true,
    catalogSearch: true,
    discovers: false,
    ...over,
  };
}

describe("formatList", () => {
  test("joins 0/1/2/3 items without an Oxford comma", () => {
    expect(formatList([])).toBe("");
    expect(formatList(["A"])).toBe("A");
    expect(formatList(["A", "B"])).toBe("A and B");
    expect(formatList(["A", "B", "C"])).toBe("A, B and C");
  });
});

describe("searchHelperText", () => {
  const hub = provider({ id: "WowUpHub", name: "WowUpHub" });
  const tukui = provider({ id: "TukUI", name: "TukUI" });
  const curseUnconfigured = provider({
    id: "Curse",
    name: "Curse",
    requiresApiKey: true,
    configured: false,
    available: false,
  });
  const curseConfigured = provider({
    id: "Curse",
    name: "Curse",
    requiresApiKey: true,
    configured: true,
  });

  test("names only the actually-available providers and the selected client", () => {
    expect(searchHelperText([hub, tukui], "Retail")).toBe(
      "Search WowUp Hub and TukUI for Retail addons",
    );
  });

  test("an enabled-but-unconfigured provider is never named", () => {
    expect(searchHelperText([hub, curseUnconfigured], "Retail")).toBe(
      "Search WowUp Hub for Retail addons",
    );
  });

  test("a single available provider reads naturally", () => {
    expect(searchHelperText([curseConfigured], "Classic Era")).toBe(
      "Search CurseForge for Classic Era addons",
    );
  });

  test("no available providers -> explicit empty-state message, not a broken sentence", () => {
    expect(searchHelperText([curseUnconfigured], "Retail")).toBe(
      "No source that searches by name is turned on. Turn one on in Options › Addon sources",
    );
    expect(searchHelperText([], "Retail")).toBe(
      "No source that searches by name is turned on. Turn one on in Options › Addon sources",
    );
  });

  test("no selected installation -> explicit prompt, not 'for null addons'", () => {
    expect(searchHelperText([hub], null)).toBe("Select a WoW installation in Options to search");
  });

  // GitHub and WowInterface are dispatched from the dedicated Install
  // from URL section — neither participates in this box at all, so
  // they must never be named here even while "available" by every
  // other measure (enabled + configured).
  const github = provider({ id: "GitHub", name: "GitHub", catalogSearch: false });
  const wowInterface = provider({ id: "WowInterface", name: "WowInterface", catalogSearch: false });

  test("a provider with catalogSearch=false is never named, even though it's otherwise available", () => {
    expect(searchHelperText([hub, github], "Retail")).toBe("Search WowUp Hub for Retail addons");
    expect(searchHelperText([hub, wowInterface], "Retail")).toBe(
      "Search WowUp Hub for Retail addons",
    );
  });

  test("when every available provider has catalogSearch=false, falls back to the empty-state message", () => {
    expect(searchHelperText([github, wowInterface], "Retail")).toBe(
      "No source that searches by name is turned on. Turn one on in Options › Addon sources",
    );
  });
});

describe("searchOutcome", () => {
  test("results present: nothing to show", () => {
    expect(searchOutcome("x", 3, []).kind).toBe("none");
  });
  test("empty without errors is a plain empty state", () => {
    const o = searchOutcome("bag", 0, []);
    expect(o.kind).toBe("empty");
    expect(o.text).toContain("bag");
  });
  test("empty with provider errors is an error naming the provider", () => {
    const o = searchOutcome("bag", 0, [{ providerId: "Curse", error: "HTTP 403" }]);
    expect(o.kind).toBe("error");
    expect(o.text).toContain("CurseForge didn't accept the request");
  });
});

describe("friendlySearchError", () => {
  test("network failures say to check the connection", () => {
    expect(friendlySearchError("TypeError: fetch failed")).toContain("internet connection");
    expect(friendlySearchError("request to x failed: ENOTFOUND")).toContain("internet connection");
  });
  test("timeouts", () => {
    expect(friendlySearchError("search timed out")).toContain("too long");
  });
  test("HTTP auth and rate limit", () => {
    expect(friendlySearchError("GET x failed: HTTP 403")).toContain("API key");
    expect(friendlySearchError("GET x failed: HTTP 429")).toContain("too many requests");
  });
  test("unknown falls back to truncated raw text", () => {
    expect(friendlySearchError("weird")).toBe("couldn't finish the search. Try again later");
  });
});

describe("installationLabel", () => {
  const installation = (over: Partial<Installation>): Installation => ({
    id: "i",
    gameType: "retail",
    path: "/wow/_retail_",
    addonsPath: "/wow/_retail_/Interface/AddOns",
    displayName: "Retail",
    clientName: "Retail",
    clientFullName: "World of Warcraft",
    source: "detected",
    selected: true,
    version: null,
    ...over,
  });

  test("no installation, no label", () => {
    expect(installationLabel(null)).toBeNull();
  });

  // The engine's client name, not the shared wire game type (RF-05: these
  // read "Classic Beta" and "Classic Era" before).
  test("a Forever installation", () => {
    expect(
      installationLabel(installation({ gameType: "classic_beta", clientName: "Forever" })),
    ).toBe("Forever");
  });

  test("an Anniversary installation", () => {
    expect(
      installationLabel(installation({ gameType: "classic_era", clientName: "Anniversary" })),
    ).toBe("Anniversary");
  });
});

describe("searchHelperText names every provider the way people know it (RF-06 pin)", () => {
  test.each([
    ["Curse", "CurseForge"],
    ["WowUpHub", "WowUp Hub"],
    ["WowInterface", "WoWInterface"],
    ["TukUI", "TukUI"],
    ["GitHub", "GitHub"],
  ])("%p", (id, name) => {
    const p = {
      id,
      name: id,
      enabled: true,
      available: true,
      requiresApiKey: false,
      configured: true,
      allowEdit: true,
      catalogSearch: true,
      discovers: false,
    };
    expect(searchHelperText([p], "Forever")).toBe(`Search ${name} for Forever addons`);
  });
});

/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import {
  GAME_VERSION_CLIENT_TAGS,
  GAME_VERSION_TAGS,
} from "../backend/src/wow/utils/client-display-names";
import { gameVersionTag, gameVersionTagList } from "./gameVersionTags";

const tag = (label: string, primary: string | null, secondary: string | null) => ({
  label,
  primary,
  secondary,
});

describe("gameVersionTag", () => {
  test("names each classic flavor with our short client names and the palette", () => {
    expect(gameVersionTag("1.15.9")).toEqual(tag("Classic Era", "#D4AF65", "#1C1408"));
    expect(gameVersionTag("1.14.4")).toEqual(tag("Classic Era", "#D4AF65", "#1C1408"));
    expect(gameVersionTag("1.60.1")).toEqual(tag("Forever", "#07566F", "#F0FCFF"));
    expect(gameVersionTag("2.5.6")).toEqual(tag("Anniversary", "#63C56B", "#09210F"));
    expect(gameVersionTag("5.5.4")).toEqual(tag("MoP", "#78BDA5", "#0B2823"));
    expect(gameVersionTag("3.4.5")).toEqual(tag("Wrath", "#68B7DA", "#0B2232"));
    expect(gameVersionTag("4.4.2")).toEqual(tag("Cataclysm", "#8B321E", "#FFF5EC"));
  });

  test("names Retail versions by expansion, since both are the Retail client", () => {
    expect(gameVersionTag("11.0.2")).toEqual(tag("War Within", "#87383E", "#FFF4F2"));
    expect(gameVersionTag("12.1.5")).toEqual(tag("Midnight", "#4C399D", "#F9F5FF"));
    expect(gameVersionTag("13.0.1")).toEqual(tag("Last Titan", "#D6AB4B", "#201809"));
  });

  test("matches by the provider's client id, so a new patch of a known client still matches", () => {
    expect(gameVersionTag("3.80.1", "titan_reforged")).toEqual(
      tag("Titan Reforged", "#594728", "#FFF4D9"),
    );
    expect(gameVersionTag("12.1.5", "retail")).toEqual(tag("Midnight", "#4C399D", "#F9F5FF"));
  });

  test("keeps an unknown version raw, with the neutral tag style", () => {
    expect(gameVersionTag("3.80.2")).toEqual(tag("3.80.2", null, null));
    expect(gameVersionTag("14.0.1")).toEqual(tag("14.0.1", null, null));
    expect(gameVersionTag("")).toEqual(tag("", null, null));
  });
});

describe("gameVersionTagList", () => {
  test("names every version of a multi-flavor release, without repeats", () => {
    expect(
      gameVersionTagList({
        gameVersion: "12.1.5",
        gameVersions: ["12.1.5", "1.60.1", "5.5.4", "1.15.9", "2.5.6"],
      }),
    ).toEqual([
      tag("Midnight", "#4C399D", "#F9F5FF"),
      tag("Forever", "#07566F", "#F0FCFF"),
      tag("MoP", "#78BDA5", "#0B2823"),
      tag("Classic Era", "#D4AF65", "#1C1408"),
      tag("Anniversary", "#63C56B", "#09210F"),
    ]);
  });

  test("names every patch of a client the provider identifies", () => {
    expect(
      gameVersionTagList({
        gameVersion: "3.80.2",
        gameVersions: ["3.80.0", "3.80.1", "3.80.2"],
        gameVersionClients: {
          "3.80.0": "titan_reforged",
          "3.80.1": "titan_reforged",
          "3.80.2": "titan_reforged",
        },
      }),
    ).toEqual([tag("Titan Reforged", "#594728", "#FFF4D9")]);
  });

  test("collapses versions of one flavor into one tag", () => {
    expect(
      gameVersionTagList({ gameVersion: "1.15.9", gameVersions: ["1.15.9", "1.15.8"] }),
    ).toEqual([tag("Classic Era", "#D4AF65", "#1C1408")]);
  });

  test("falls back to the single version, as a one-tag line", () => {
    expect(gameVersionTagList({ gameVersion: "11.0.2", gameVersions: null })).toEqual([
      tag("War Within", "#87383E", "#FFF4F2"),
    ]);
    expect(gameVersionTagList({ gameVersion: "1.60.1", gameVersions: null })).toEqual([
      tag("Forever", "#07566F", "#F0FCFF"),
    ]);
  });

  test("nothing when no version is known", () => {
    expect(gameVersionTagList({ gameVersion: null, gameVersions: null })).toEqual([]);
    expect(gameVersionTagList({ gameVersion: null, gameVersions: [] })).toEqual([]);
  });
});

/** WCAG relative luminance of an sRGB hex color (0-255 channels). */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/** WCAG contrast ratio between two sRGB hex colors. */
function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

describe("version tag palette", () => {
  // Both tables share the classic flavors, so dedupe by label and colors:
  // what is left is one entry per expansion on the palette.
  const palette = [
    ...new Map(
      [...Object.values(GAME_VERSION_TAGS), ...Object.values(GAME_VERSION_CLIENT_TAGS)].map((t) => [
        `${t.label}|${t.primary}|${t.secondary}`,
        t,
      ]),
    ).values(),
  ];

  test("covers every expansion and flavor", () => {
    expect(palette.map((t) => t.label).sort()).toEqual([
      "Anniversary",
      "BfA",
      "Cataclysm",
      "Classic Era",
      "Dragonflight",
      "Forever",
      "Last Titan",
      "Legion",
      "Midnight",
      "MoP",
      "Shadowlands",
      "Titan Reforged",
      "War Within",
      "Warlords",
      "Wrath",
    ]);
  });

  test("every background/text pair meets WCAG 2.2 AAA for normal text (>= 7:1)", () => {
    for (const t of palette) {
      expect(
        contrastRatio(t.primary, t.secondary),
        `${t.label}: ${t.primary} on ${t.secondary}`,
      ).toBeGreaterThanOrEqual(7);
    }
  });

  test("no two expansions reuse a primary color", () => {
    expect(new Set(palette.map((t) => t.primary)).size).toBe(palette.length);
  });
});

/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { relationshipCount, relationshipGroups, type Relationships } from "./relationships";

describe("relationshipGroups (WF-11)", () => {
  const provider: Relationships = {
    kind: "provider",
    providerId: "Curse",
    items: [
      { externalId: "3", relation: "embedded" },
      { externalId: "1", relation: "required" },
      { externalId: "2", relation: "optional" },
      { externalId: "9", relation: "required" },
    ],
  };

  test("groups in CurseForge's order with looked-up names; unknown ids still show", () => {
    const groups = relationshipGroups(provider, [
      { externalId: "1", name: "DBM-Core", thumbnailUrl: "t1", installed: true },
      { externalId: "2", name: "Opt", thumbnailUrl: null, installed: false },
      { externalId: "3", name: "LibStub", thumbnailUrl: null, installed: false },
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Required", "Optional", "Embedded libraries"]);
    expect(groups[0]!.rows).toEqual([
      { key: "1", name: "DBM-Core", thumbnailUrl: "t1", tag: "Installed" },
      { key: "9", name: "Not available for this game version", thumbnailUrl: null, tag: null },
    ]);
  });

  test("before names arrive, rows show ids; empty groups are left out", () => {
    const only: Relationships = {
      kind: "provider",
      providerId: "Curse",
      items: [{ externalId: "1", relation: "required" }],
    };
    expect(relationshipGroups(only, null)).toEqual([
      expect.objectContaining({
        title: "Required",
        rows: [expect.objectContaining({ name: "Loading…" })],
      }),
    ]);
  });

  test("an installed addon's TOC dependencies: installed or missing", () => {
    const toc: Relationships = {
      kind: "toc",
      items: [
        { name: "Ace3", installed: true },
        { name: "LibStub", installed: false },
      ],
    };
    expect(relationshipGroups(toc, null)[0]!.rows.map((r) => `${r.name}:${r.tag}`)).toEqual([
      "Ace3:Installed",
      "LibStub:Missing",
    ]);
    expect(relationshipCount(toc)).toBe(2);
    expect(relationshipCount(null)).toBe(0);
  });
});

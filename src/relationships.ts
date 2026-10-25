/**
 * The Details "Relationships" page (WF-11; CurseForge's website has a tab of
 * that name). Dependencies only: CurseForge's API has no dependants list
 * (the addons that need this one), and WowUp has none either.
 */
export type Relation = "required" | "optional" | "embedded";

export type Relationships =
  /** A provider result: ids from the file that would be installed; names are looked up. */
  | { kind: "provider"; providerId: string; items: { externalId: string; relation: Relation }[] }
  /** An installed addon: the TOC's required dependencies, folder names, and whether each is in AddOns. */
  | { kind: "toc"; items: { name: string; installed: boolean }[] };

export interface LookedUp {
  externalId: string;
  name: string;
  thumbnailUrl: string | null;
  installed: boolean;
}

export interface RelationshipRow {
  key: string;
  name: string;
  thumbnailUrl: string | null;
  /** "Installed", "Missing" or none. */
  tag: "Installed" | "Missing" | null;
}

export interface RelationshipGroup {
  title: string;
  /** One line under the title saying what the group means here. */
  note: string;
  rows: RelationshipRow[];
}

const GROUPS: { relation: Relation; title: string; note: string }[] = [
  { relation: "required", title: "Required", note: "Installed along with this addon" },
  {
    relation: "optional",
    title: "Optional",
    note: "Adds features when installed; not installed automatically",
  },
  {
    relation: "embedded",
    title: "Embedded libraries",
    note: "Ship inside this addon; nothing to install",
  },
];

export function relationshipCount(r: Relationships | null | undefined): number {
  return r?.items.length ?? 0;
}

/**
 * The page's groups, in CurseForge's order (required, optional, embedded),
 * empty groups left out. Provider ids not found (no file for this game
 * version) still show, as "Not available for this game version".
 */
export function relationshipGroups(
  r: Relationships,
  names: LookedUp[] | null,
): RelationshipGroup[] {
  if (r.kind === "toc") {
    return r.items.length
      ? [
          {
            title: "Required",
            note: "From the addon's own files; it doesn't load without them",
            rows: r.items.map((d) => ({
              key: d.name,
              name: d.name,
              thumbnailUrl: null,
              tag: d.installed ? "Installed" : "Missing",
            })),
          },
        ]
      : [];
  }
  const byId = new Map((names ?? []).map((n) => [n.externalId, n]));
  return GROUPS.flatMap(({ relation, title, note }) => {
    const rows = r.items
      .filter((i) => i.relation === relation)
      .map((i): RelationshipRow => {
        const found = byId.get(i.externalId);
        return {
          key: i.externalId,
          // No ids on screen (C05): loading, or not found for this game version.
          name: found?.name ?? (names ? "Not available for this game version" : "Loading…"),
          thumbnailUrl: found?.thumbnailUrl ?? null,
          tag: found?.installed ? "Installed" : null,
        };
      });
    return rows.length ? [{ title, note, rows }] : [];
  });
}

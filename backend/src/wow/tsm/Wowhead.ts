/**
 * Which section of Wowhead describes an installation's items. Project-owned.
 * Wowhead keeps one database per game: Retail at the site root, the others
 * under a path prefix (checked 2026-11-24 against wowhead.com: `/classic/`,
 * `/tbc/`, `/wotlk/`, `/cata/`, `/mop-classic/`, `/forever/`, `/ptr/`,
 * `/classic-ptr/`). A Classic client that moves through expansions is told
 * apart by its client version. Betas, and anything this table cannot place,
 * get no section, so the Ledger offers no link rather than a wrong item.
 */
import type { WowInstallation } from "../models";
import { WowClientType } from "../types";

/** Classic progression sections by the client version's major number. */
const BY_MAJOR: Record<string, string> = {
  "1": "classic",
  "2": "tbc",
  "3": "wotlk",
  "4": "cata",
  "5": "mop-classic",
};

const byVersion = (version: string | undefined): string | null =>
  BY_MAJOR[/^(\d+)\./.exec(version ?? "")?.[1] ?? ""] ?? null;

/**
 * The installation's Wowhead section: "" for Retail (the site root), a path
 * segment such as "classic" or "mop-classic", or null when Wowhead has no
 * section for it.
 */
export function wowheadSection({ clientType, version }: Pick<WowInstallation, "clientType" | "version">): string | null {
  switch (clientType) {
    case WowClientType.Retail:
      return "";
    case WowClientType.RetailPtr:
    case WowClientType.RetailXPtr:
      return "ptr";
    case WowClientType.ClassicEra:
      return "classic";
    case WowClientType.ClassicEraPtr:
      return "classic-ptr";
    case WowClientType.Forever:
      return "forever";
    case WowClientType.Classic:
    case WowClientType.Anniversary:
    case WowClientType.ClassicTitan:
      return byVersion(version);
    default:
      return null;
  }
}

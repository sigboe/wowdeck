import type { Addon, DetailsResult } from "./types";
import { dependencyNote, type DependencyNote } from "./detailsHeader";
import type { Relationships } from "./relationships";

/**
 * What the Details modal shows for an installed addon (My Addons): the
 * result shape the modal is built on, filled from the fields an installed
 * addon has. The search-only fields (downloads, release day, the gallery)
 * are empty; the latest version is the update on offer when there is one,
 * else the installed version. The dependencies line and the Relationships
 * page come from the TOC, which names folders and says which are missing.
 */
export function installedDetails(addon: Addon): {
  result: DetailsResult;
  dependencies: DependencyNote | null;
  relationships: Relationships | null;
} {
  return {
    result: {
      providerId: addon.providerId ?? "",
      externalId: addon.externalId ?? "",
      name: addon.name,
      author: addon.author,
      downloadCount: null,
      summary: addon.notes,
      thumbnailUrl: addon.thumbnailUrl,
      websiteUrl: addon.externalUrl,
      latestVersion: addon.availableVersion ?? addon.version,
      gameVersion: addon.gameVersion,
      gameVersions: addon.gameVersion ? [addon.gameVersion] : null,
      gameVersionClients: null,
      releasedAt: null,
      channel: null,
      screenshots: [],
    },
    dependencies: dependencyNote({
      required: addon.dependencies,
      missing: addon.missingDependencies ?? [],
    }),
    relationships: {
      kind: "toc",
      items: addon.dependencies.map((name) => ({
        name,
        installed: !(addon.missingDependencies ?? []).includes(name),
      })),
    },
  };
}

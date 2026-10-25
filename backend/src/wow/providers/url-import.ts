/**
 * Install from URL dispatch. Deterministic: each checker
 * validates a specific, exact hostname shape — unlike upstream's
 * insertion-order-dependent `isValidAddonUri` iteration, so
 * dispatch order here can never change the result; a given input either
 * matches exactly one provider's shape or none. A direct archive link
 * (WF-09) is the fallback for every other address: a release asset on
 * github.com still goes to GitHub, which tracks its updates.
 */

import { parseGitHubRepoQuery } from "./github/GitHubProvider";
import { parseWowInterfaceQuery } from "./wowinterface/WowInterfaceProvider";
import { parseArchiveUrl } from "./zip/ZipProvider";
import { PROVIDER_ID } from "../../api/providers";

export type UrlImportProviderId =
  | typeof PROVIDER_ID.GitHub
  | typeof PROVIDER_ID.WowInterface
  | typeof PROVIDER_ID.Zip;

/** Which provider (if any) should handle this Install from URL input. */
export function identifyUrlImportProvider(input: string): UrlImportProviderId | null {
  if (parseGitHubRepoQuery(input)) {
    return PROVIDER_ID.GitHub;
  }
  if (parseWowInterfaceQuery(input)) {
    return PROVIDER_ID.WowInterface;
  }
  if (parseArchiveUrl(input)) {
    return PROVIDER_ID.Zip;
  }
  return null;
}

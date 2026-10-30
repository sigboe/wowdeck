/**
 * Install from a local archive file (Manual Install, From a file).
 * Project-owned: WowUp upstream has no local-file import anywhere in its
 * history (verified at the pinned reference, 2026-10-24), so nothing here
 * is mirrored from it. The provider deliberately mirrors the Zip (direct
 * link) provider's semantics instead — see
 * wowup/wowup-electron/src/app/addon-providers/zip-provider.ts, commit
 * 4fdae600d94ad7dd187a6bc93b517e657100b01a (semantics mirrored only, no
 * code shared, so no provenance entry): the archive is the addon's id, there is
 * no catalog behind it, so the addon has no updates, no channels and no
 * reinstall, and update checks never ask about it. The archive itself
 * feeds the normal transactional installer (AddonInstaller): only this
 * provider's answer differs.
 */

import type { AddonSearchResult } from "../../models";
import { AddonChannelType } from "../../types";
import { AddonProvider } from "../addon-provider";
import { canonicalLocalArchive, isSupportedArchivePath } from "../../archives/localArchive";
import { PROVIDER_ID } from "../../../api/providers";

export class FileProvider extends AddonProvider {
  override name = PROVIDER_ID.File;
  override enabled = true;
  // Never a settings toggle, never in the name search: a picked file is
  // its only way in.
  override allowEdit = false;

  override isValidAddonId(addonId: string): boolean {
    return isSupportedArchivePath(addonId);
  }

  /**
   * No name of its own: like a direct link's, the installer names the
   * addon from its TOC title (the file name as the last resort). The
   * path is validated here, so a missing file fails the install before
   * anything is staged.
   */
  override async getById(addonId: string): Promise<AddonSearchResult | undefined> {
    return this.#result(await canonicalLocalArchive(addonId));
  }

  #result(path: string): AddonSearchResult {
    return {
      author: "",
      externalId: path,
      // No addon page behind a file: no "View on".
      externalUrl: "",
      name: "",
      providerName: this.name,
      files: [
        {
          // The picked file is the release: installed and latest are the
          // same release id, so the addon never shows an update.
          externalId: path,
          channelType: AddonChannelType.Stable,
          version: "",
          folders: [],
          gameVersion: "",
          downloadUrl: path,
          releaseDate: "",
        },
      ],
    };
  }
}

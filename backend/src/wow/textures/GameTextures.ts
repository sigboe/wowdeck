/**
 * Icons read straight from an installation's game files (project-owned):
 * FileDataID → BLP from local storage (CascStorage) → the mipmap that fits
 * → PNG data URL. Nothing is saved on disk; per installation, memory keeps
 * only the places of the IDs looked up, for as long as the build stays the
 * same. A patch (another build key in `.build.info`) starts over.
 */
import { join } from "node:path";
import { CascStorage } from "../casc/CascStorage";
import { readFlavorBuildInfo } from "../installation/InstallationDetector";
import type { WowInstallation } from "../models";
import { decodeBlp } from "./Blp";
import { encodePng } from "./Png";

/** A Ledger page holds 40 rows; the cap bounds one answer's size. */
export const MAX_ICONS = 64;
/** A 64 px icon is the largest WoW keeps; asking more decodes the same level. */
export const MAX_ICON_SIZE = 512;

export class GameTextures {
  /** Each installation's open storage, by its flavor folder. */
  readonly #storages = new Map<string, Promise<CascStorage | null>>();

  /**
   * PNG data URLs for `fileIds`, shown `size` device pixels wide, keyed by
   * ID. IDs the installation's files lack are left out, as are all of them
   * when it has no local storage (no `.build.info`, as in a copied install).
   * `alsoLikely` lists IDs to look up in the same pass (CascStorage.locate).
   */
  async icons(
    installation: WowInstallation,
    fileIds: readonly number[],
    size: number,
    alsoLikely?: () => Iterable<number>,
  ): Promise<Record<string, string>> {
    const storage = await this.#storage(installation);
    const icons: Record<string, string> = {};
    if (!storage) return icons;
    const ids = [...new Set(fileIds)];
    await storage.locate(ids, alsoLikely);
    for (const id of ids) {
      const blp = await storage.read(id);
      const image = blp && decodeBlp(blp, size);
      if (image) icons[id] = `data:image/png;base64,${Buffer.from(encodePng(image)).toString("base64")}`;
    }
    return icons;
  }

  async #storage(installation: WowInstallation): Promise<CascStorage | null> {
    const buildKey = (await readFlavorBuildInfo(installation.location))?.["Build Key"];
    if (!buildKey) return null;
    const open = this.#storages.get(installation.location);
    const current = open && await open;
    if (current?.buildKey === buildKey.toLowerCase()) return current;
    const next = CascStorage.open(join(installation.location, ".."), buildKey);
    this.#storages.set(installation.location, next);
    return next;
  }
}

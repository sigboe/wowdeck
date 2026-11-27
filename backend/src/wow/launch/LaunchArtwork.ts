import { createHash } from "node:crypto";
import { opendir, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import type { LaunchIconRead } from "./LaunchIcons";
import { isLaunchSvg } from "./LaunchSvg";

/** Extend this product set when another launch row gains preferred artwork. */
export const preferredArtworkProducts: ReadonlySet<string> = new Set(["WoW"]);

export interface Artwork {
  bytes: Uint8Array;
  catalogue: string;
  asset: string;
  product: string;
}
const md5 = (bytes: Uint8Array) => createHash("md5").update(bytes).digest("hex");
const digest = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Local heuristic: newest valid catalogue, then descending hash. This is
 * not a claim about the catalogue currently active in Battle.net. Reads are
 * sequential, capped at 20k directory entries and 32 MiB per source attempt. */
export async function discoverArtwork(
  prefix: string,
  read: LaunchIconRead,
): Promise<Map<string, Artwork>> {
  const result = new Map<string, Artwork>();
  const root = await realpath(
    join(prefix, "drive_c/users/steamuser/AppData/Local/Battle.net/Cache"),
  ).catch(() => undefined);
  if (!root || !root.startsWith(prefix + sep)) return result;
  let entries = 0;
  let exhausted = false;
  let budget = 32 * 1024 * 1024;
  const contained = async (path: string) => {
    const canonical = await realpath(path).catch(() => undefined);
    return canonical && canonical.startsWith(root + sep) ? canonical : undefined;
  };
  const boundedRead = async (path: string, limit: number) => {
    if (limit > budget) return undefined;
    budget -= limit;
    const safe = await contained(path);
    return safe ? read(safe, limit).catch(() => undefined) : undefined;
  };
  const candidates: Array<{ path: string; hash: string; mtime: number; size: number }> = [];
  async function walk(path: string, depth: number): Promise<void> {
    if (entries >= 20000) {
      exhausted = true;
      return;
    }
    const safe = await contained(path);
    // The root itself is trusted only after its prefix containment check.
    const dir = await opendir(path === root ? root : (safe ?? "")).catch(() => undefined);
    if (!dir) return;
    for await (const entry of dir) {
      if (++entries > 20000) {
        exhausted = true;
        break;
      }
      const next = join(path, entry.name);
      if (depth < 2) {
        if (entry.isDirectory() && /^[a-f0-9]{2}$/.test(entry.name)) await walk(next, depth + 1);
      } else if (
        entry.isFile() &&
        digest(entry.name) &&
        entry.name.startsWith(path.slice(-5).replace(sep, ""))
      ) {
        const info = await stat(next).catch(() => undefined);
        if (info && info.size <= 4 * 1024 * 1024)
          candidates.push({ path: next, hash: entry.name, mtime: info.mtimeMs, size: info.size });
      }
    }
  }
  await walk(root, 0);
  if (exhausted) return result;
  candidates.sort((a, b) => b.mtime - a.mtime || (a.hash < b.hash ? 1 : a.hash > b.hash ? -1 : 0));
  for (const candidate of candidates) {
    // Read only a prefix of binary files. The read seam enforces a file size
    // limit, so slice explicitly for this cheap catalogue discriminator.
    const safe = await contained(candidate.path);
    if (!safe || budget < 256) continue;
    budget -= 256;
    const head = await Bun.file(safe)
      .slice(0, 256)
      .text()
      .catch(() => "");
    if (!head.trimStart().startsWith("{")) continue;
    const bytes = await boundedRead(safe, candidate.size);
    if (!bytes || md5(bytes) !== candidate.hash) continue;
    let catalogue: unknown;
    try {
      catalogue = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      continue;
    }
    if (
      !object(catalogue) ||
      catalogue.fragment_id !== "world_of_warcraft" ||
      !Array.isArray(catalogue.products) ||
      catalogue.products.length > 256 ||
      !object(catalogue.files) ||
      !object(catalogue.files.default)
    )
      continue;
    for (const product of catalogue.products) {
      if (
        !object(product) ||
        typeof product.id !== "string" ||
        !preferredArtworkProducts.has(product.id) ||
        result.has(product.id) ||
        !object(product.base)
      )
        continue;
      const reference = product.base.icon_svg;
      if (
        typeof reference !== "string" ||
        reference.length > 512 ||
        !Object.hasOwn(catalogue.files.default, reference)
      )
        continue;
      const file = catalogue.files.default[reference];
      if (!object(file) || !digest(file.hash)) continue;
      const asset = await boundedRead(
        join(root, file.hash.slice(0, 2), file.hash.slice(2, 4), file.hash),
        256 * 1024,
      );
      if (asset && md5(asset) === file.hash && isLaunchSvg(asset))
        result.set(product.id, {
          bytes: asset,
          catalogue: candidate.hash,
          asset: file.hash,
          product: product.id,
        });
    }
    if ([...preferredArtworkProducts].every((product) => result.has(product))) break;
  }
  return result;
}

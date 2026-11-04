/**
 * Archives that differ only in what their top-level folders hold, shared by
 * the File provider suite (preview and install) and the installer suite so
 * both paths run the very same bytes through the Addon folder rule.
 */

import { spyOn } from "bun:test";
import { zipSync } from "fflate";

const text = (s: string) => new TextEncoder().encode(s);
const toc = (title: string) => text(`## Interface: 110005\n## Title: ${title}\n## Version: 1.0\n`);

/** Every extension spelling the rule must accept, one folder each. */
export const upperCaseTocZip = zipSync({ "Foo/FOO.TOC": toc("Foo Upper") });
export const mixedCaseTocZip = zipSync({ "Foo/Foo.Toc": toc("Foo Mixed") });

/** A TOC that only lives below the top-level folder: that folder has none. */
export const nestedOnlyTocZip = zipSync({
  "Foo/readme.txt": text("readme\n"),
  "Foo/docs/Foo.toc": toc("Foo Nested"),
});

/** A directory named like a TOC is not a TOC file. */
export const tocNamedDirectoryZip = zipSync({ "Foo/Foo.toc/notes.txt": text("not a toc\n") });

/** An addon folder next to a folder that holds no TOC. */
export const addonAndDocsZip = zipSync({
  "Foo/Foo.toc": toc("Foo Addon"),
  "Docs/readme.txt": text("readme\n"),
});

/** No folder at all, only a loose file. */
export const looseFileZip = zipSync({ "README.md": text("readme\n") });

/** An addon folder whose only TOC is empty: no title, author, version or interface. */
export const emptyTocZip = zipSync({ "Foo/Foo.toc": text("") });

/** The only TOC is for another WoW client than the retail installations the tests use. */
export const otherClientTocZip = zipSync({ "Foo/Foo-Classic.toc": toc("Foo Classic") });

/** A generic and a retail-specific TOC side by side: retail takes the specific one. */
export const genericAndMainlineZip = zipSync({
  "Foo/Foo.toc": text("## Interface: 110005\n## Title: Foo Generic\n## Version: 1.0\n## Author: Generic Author\n"),
  "Foo/Foo-Mainline.toc": text("## Interface: 110005\n## Title: Foo Mainline\n## Version: 2.0\n## Author: Mainline Author\n"),
});

/**
 * A bundle whose two folders state different metadata, so the folder order a
 * caller uses decides which TOC represents the archive. Sorted, Alpha leads;
 * an installer that plans Zeta first reads Zeta.
 */
export const orderBundleZip = zipSync({
  "Alpha/Alpha.toc": text("## Interface: 110005\n## Title: Alpha Suite\n## Version: 1.0\n## Author: Alpha Author\n"),
  "Zeta/Zeta.toc": text("## Interface: 110005\n## Title: Zeta Suite\n## Version: 2.0\n## Author: Zeta Author\n"),
});

/**
 * Make reading any TOC whose path ends in `pathSuffix` fail, at the file
 * boundary the TOC parser reads through (Bun.file). Nothing else changes, so
 * the failure is the same under root and without permission tricks. Call the
 * returned function to put the real reader back.
 */
export function failTocReads(pathSuffix: string): () => void {
  const realFile = Bun.file.bind(Bun);
  const spy = spyOn(Bun, "file").mockImplementation(((path: unknown, ...rest: unknown[]) =>
    typeof path === "string" && path.endsWith(pathSuffix)
      ? { text: async () => { throw new Error("EIO: TOC read failed"); } }
      : (realFile as (...a: unknown[]) => unknown)(path, ...rest)) as typeof Bun.file);
  return () => spy.mockRestore();
}

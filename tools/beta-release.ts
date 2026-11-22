/**
 * The beta workflow's (.github/workflows/beta.yml) decisions, as pure
 * functions over tag names; the workflow only feeds this script and `gh`.
 *
 *   git tag -l 'v*' | bun tools/beta-release.ts next-version <run number>
 *   gh release list ... | bun tools/beta-release.ts prune
 *
 * Tags arrive one per line on stdin; answers go to stdout, one per line.
 */

import { compareParsed, compareReleases, parseVersion, type Version } from "../backend/src/api/version";
import { stdinLines } from "./stdin-lines";

/** A tag `v<canonical version>`; anything else (a leading zero, -rc1) is no WoWDeck tag here. */
function tagVersion(tag: string): Version | null {
  return tag.startsWith("v") ? parseVersion(tag.slice(1)) : null;
}

/** How many beta releases stay published. */
export const BETAS_KEPT = 3;

/** Beta tags only, newest version first. The only form pruning matches, so a stable tag is never selected. */
function betasNewestFirst(tags: string[]): string[] {
  const betas: { tag: string; version: Version }[] = [];
  for (const tag of tags) {
    const version = tagVersion(tag);
    if (version?.form === "beta") betas.push({ tag, version });
  }
  betas.sort((a, b) => compareParsed(b.version, a.version));
  return betas.map((b) => b.tag);
}

/** The beta tags beyond the newest `keep`, newest first; never a non-beta tag. */
export function betasToPrune(tags: string[], keep: number = BETAS_KEPT): string[] {
  return betasNewestFirst(tags).slice(keep);
}

/** The newest stable tag with patch+1, e.g. 0.3.1 after v0.3.0; 0.0.1 before any. */
export function nextPatchBase(tags: string[]): string {
  let newest: Version | null = null;
  for (const tag of tags) {
    const version = tagVersion(tag);
    if (version?.form === "stable" && (newest === null || compareReleases(version, newest) > 0)) newest = version;
  }
  const [major, minor, patch] = newest?.release ?? [0, 0, 0];
  return `${major}.${minor}.${patch + 1}`;
}

/** `<newest stable tag with patch+1>-beta.<run number>`, e.g. 0.3.1-beta.57 after v0.3.0. */
export function nextBetaVersion(tags: string[], runNumber: number): string {
  return `${nextPatchBase(tags)}-beta.${runNumber}`;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const tags = await stdinLines();
  const print = (lines: string[]) => {
    if (lines.length > 0) process.stdout.write(lines.join("\n") + "\n");
  };
  if (command === "next-version" && args.length === 1 && /^[1-9]\d*$/.test(args[0])) {
    print([nextBetaVersion(tags, Number(args[0]))]);
  } else if (command === "prune" && args.length === 0) {
    print(betasToPrune(tags));
  } else {
    console.error(
      "usage: beta-release.ts next-version <run number> | prune  (tags on stdin)",
    );
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

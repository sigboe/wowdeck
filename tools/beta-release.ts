/**
 * The beta workflow's (.github/workflows/beta.yml) decisions, as pure
 * functions over tag names; the workflow only feeds this script and `gh`.
 *
 *   git tag -l 'v*' | bun tools/beta-release.ts next-version <run number>
 *   gh release list ... | bun tools/beta-release.ts previous-beta
 *   gh release list ... | bun tools/beta-release.ts prune
 *
 * Tags arrive one per line on stdin; answers go to stdout, one per line.
 */

// Semver numbers: no leading zeros, as tools/version.py's SEMVER and BETA.
const N = String.raw`(0|[1-9]\d*)`;
const STABLE_TAG = new RegExp(`^v${N}\\.${N}\\.${N}$`);
/** The only shape pruning ever matches, so stable tags can never be selected. */
const BETA_TAG = new RegExp(`^v${N}\\.${N}\\.${N}-beta\\.${N}$`);

/** How many beta releases stay published. */
export const BETAS_KEPT = 3;

type Triple = [number, number, number];

function compareTriples(a: Triple, b: Triple): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Beta tags only, newest version first. */
function betasNewestFirst(tags: string[]): string[] {
  const betas: { tag: string; base: Triple; run: number }[] = [];
  for (const tag of tags) {
    const m = BETA_TAG.exec(tag);
    if (m) betas.push({ tag, base: [Number(m[1]), Number(m[2]), Number(m[3])], run: Number(m[4]) });
  }
  betas.sort((a, b) => compareTriples(b.base, a.base) || b.run - a.run);
  return betas.map((b) => b.tag);
}

/** The beta tags beyond the newest `keep`, newest first; never a non-beta tag. */
export function betasToPrune(tags: string[], keep: number = BETAS_KEPT): string[] {
  return betasNewestFirst(tags).slice(keep);
}

/** `<newest stable tag with patch+1>-beta.<run number>`, e.g. 0.3.1-beta.57 after v0.3.0. */
export function nextBetaVersion(tags: string[], runNumber: number): string {
  let newest: Triple = [0, 0, 0];
  for (const tag of tags) {
    const m = STABLE_TAG.exec(tag);
    if (!m) continue;
    const triple: Triple = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (compareTriples(triple, newest) > 0) newest = triple;
  }
  return `${newest[0]}.${newest[1]}.${newest[2] + 1}-beta.${runNumber}`;
}

/** The newest beta tag, where the next beta's generated notes start; null before the first. */
export function previousBeta(tags: string[]): string | null {
  return betasNewestFirst(tags)[0] ?? null;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const tags = (await Bun.stdin.text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const print = (lines: string[]) => {
    if (lines.length > 0) process.stdout.write(lines.join("\n") + "\n");
  };
  if (command === "next-version" && args.length === 1 && /^[1-9]\d*$/.test(args[0])) {
    print([nextBetaVersion(tags, Number(args[0]))]);
  } else if (command === "previous-beta" && args.length === 0) {
    const tag = previousBeta(tags);
    print(tag === null ? [] : [tag]);
  } else if (command === "prune" && args.length === 0) {
    print(betasToPrune(tags));
  } else {
    console.error(
      "usage: beta-release.ts next-version <run number> | previous-beta | prune  (tags on stdin)",
    );
    return 1;
  }
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

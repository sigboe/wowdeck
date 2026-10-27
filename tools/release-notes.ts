/**
 * Release notes for a GitHub release, taken from CHANGELOG.md rather than
 * generated from PR titles: the changelog is written for players, PR titles
 * for reviewers. Both release workflows publish its output as the release
 * body, which the plugin's update panel shows.
 *
 *   bun tools/release-notes.ts 1.2.0 > notes.md      # stable: its section
 *   bun tools/release-notes.ts Unreleased > notes.md # beta: what's unreleased
 *
 * A stable version without a non-empty section fails, so a release is never
 * published without notes. A beta with nothing unreleased gets FALLBACK.
 */

/** Beta notes when nothing player-visible is unreleased (CI, docs, refactors). */
export const FALLBACK = "Small fixes and improvements.";

/**
 * The body under `## [<name>]` (any `- <date>` suffix allowed), up to the
 * next `## ` heading or the link references; null when absent or empty.
 */
export function sectionNotes(changelog: string, name: string): string | null {
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => {
    const m = /^## \[([^\]]+)\]/.exec(line);
    return m !== null && m[1] === name;
  });
  if (start < 0) return null;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ") || /^\[[^\]]+\]: /.test(line)) break;
    body.push(line);
  }
  const notes = body.join("\n").trim();
  return notes === "" ? null : notes;
}

async function main(argv: string[]): Promise<number> {
  const [name, path = "CHANGELOG.md", ...rest] = argv;
  if (!name || rest.length > 0) {
    console.error("usage: release-notes.ts <X.Y.Z | Unreleased> [CHANGELOG.md]");
    return 1;
  }
  const notes = sectionNotes(await Bun.file(path).text(), name);
  if (notes === null && name !== "Unreleased") {
    console.error(`${path} has no notes under "## [${name}]"; write them before tagging`);
    return 1;
  }
  process.stdout.write((notes ?? FALLBACK) + "\n");
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

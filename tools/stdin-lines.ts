/**
 * The release tools' input: tags (or other names), one per line on stdin,
 * as `git tag -l` and `gh release list` print them. Blank lines and
 * surrounding whitespace are dropped.
 */
export async function stdinLines(): Promise<string[]> {
  return (await Bun.stdin.text())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

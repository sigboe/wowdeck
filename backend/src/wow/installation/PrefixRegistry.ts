/** Project-owned Wine registry discovery. Only Blizzard WoW path values are retained. */
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { isDirectory, listDirectory } from "../fs/safe-fs";
import { WOW_FLAVOR_FOLDERS } from "../toc/toc";

// Do not log paths, registry text, or exception messages: they can contain personal data.
function skipped(reason: string): void {
  console.error(JSON.stringify({ component: "prefix-registry", reason }));
}

/** Scan known prefix roots, reading each physical registry once. No recursive disk search. */
export async function prefixRegistryDiscoveries(prefixes: Iterable<string>): Promise<Array<{ prefix: string; roots: string[] }>> {
  const canonical = new Set<string>();
  for (const prefix of prefixes) {
    const path = await realpath(prefix).catch(() => undefined);
    if (!path || canonical.has(path) || !(await isDirectory(path))) continue;
    canonical.add(path);
  }
  const readable: string[] = [];
  for (const prefix of canonical) {
    try {
      if ((await stat(join(prefix, "system.reg"))).isFile()) readable.push(prefix);
      else skipped("unreadable-registry");
    } catch (error) {
      skipped((error as NodeJS.ErrnoException).code === "ENOENT" ? "missing-registry" : "unreadable-registry");
    }
  }
  const matching = await matchingRegistries(readable);
  const results: Array<{ prefix: string; roots: string[] }> = [];
  for (let i = 0; i < matching.length; i += 4) {
    results.push(...await Promise.all(matching.slice(i, i + 4).map(async (prefix) => ({ prefix, roots: await prefixRegistryRoots(prefix) }))));
  }
  return results;
}

/** Grep is an optional prefilter. Failure falls back to the same Bun parser. */
async function matchingRegistries(prefixes: string[]): Promise<string[]> {
  const grep = Bun.which("grep");
  if (!grep) return prefixes;
  const matching: string[] = [];
  // Keep argv well below Linux's argument limit, including unusually long paths.
  const batches: string[][] = [];
  let batch: string[] = [];
  let bytes = 0;
  for (const prefix of prefixes) {
    const size = Buffer.byteLength(join(prefix, "system.reg")) + 1;
    if (batch.length && (bytes + size > 32 * 1024 || batch.length >= 128)) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(prefix);
    bytes += size;
  }
  if (batch.length) batches.push(batch);
  for (const paths of batches) {
    try {
      const proc = Bun.spawn([grep, "-a", "-i", "-l", "-Z", "-F", "--", "World of Warcraft", ...paths.map(p => join(p, "system.reg"))], {
        stdin: "ignore", stdout: "pipe", stderr: "ignore",
        env: { ...process.env, LC_ALL: "C" }, timeout: 5000,
      });
      const [output, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      if (code !== 0 && code !== 1) {
        matching.push(...paths);
        continue;
      }
      const files = new Set(output.split("\0"));
      matching.push(...paths.filter(path => files.has(join(path, "system.reg"))));
    } catch {
      matching.push(...paths);
    }
  }
  return matching;
}

async function resolveCase(path: string): Promise<string | undefined> {
  if (await isDirectory(path)) return path;
  let current = "/";
  for (const segment of path.split("/").filter(Boolean)) {
    const exact = join(current, segment);
    if (await isDirectory(exact)) {
      current = exact;
      continue;
    }
    const matches = (await listDirectory(current)).filter(
      (entry) => entry.name.toLowerCase() === segment.toLowerCase(),
    );
    if (matches.length !== 1) {
      skipped(matches.length ? "ambiguous-path" : "missing-path");
      return undefined;
    }
    current = matches[0]!.path;
    if (!(await isDirectory(current))) return undefined;
  }
  return current;
}

async function translate(prefix: string, windowsPath: string): Promise<string | undefined> {
  const match = /^([a-z]):\\(.*)$/i.exec(windowsPath);
  if (!match) return undefined;
  let drive: string;
  try {
    // Only letter-colon entries are considered; letter-colon-colon raw devices never are.
    drive = await realpath(join(prefix, "dosdevices", `${match[1]!.toLowerCase()}:`));
  } catch {
    skipped("unmapped-drive");
    return undefined;
  }
  return resolveCase(resolve(drive, ...match[2]!.split("\\")));
}

/** Read system.reg a line at a time; user.reg and product.db are never opened. */
export async function prefixRegistryRoots(prefix: string): Promise<string[]> {
  const paths: Array<{ path: string; installPath: boolean }> = [];
  const input = createReadStream(join(prefix, "system.reg"), { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  let valueName: "InstallPath" | "InstallLocation" | undefined;
  try {
    for await (const line of lines) {
      if (line.startsWith("[")) {
        const section = /^\[(.*)\]/.exec(line)?.[1]?.replaceAll("\\\\", "\\");
        valueName = undefined;
        if (
          section &&
          /^Software\\Wow6432Node\\Blizzard Entertainment\\World of Warcraft(?:\\.*)?$/i.test(
            section,
          )
        ) {
          valueName = "InstallPath";
        } else if (
          section &&
          /^Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\World of Warcraft[^\\]*$/i.test(
            section,
          )
        ) {
          valueName = "InstallLocation";
        }
        continue;
      }
      if (!valueName) continue;
      const value = /^"(InstallPath|InstallLocation)"="((?:[^"\\]|\\.)*)"\s*$/i.exec(line);
      if (value?.[1]?.toLowerCase() !== valueName.toLowerCase()) continue;
      const path = value[2]!.replace(/\\([\\"])/g, "$1").replace(/\\+$/, "");
      paths.push({ path, installPath: valueName === "InstallPath" });
    }
  } catch (error) {
    // Steam leaves save-only prefixes without system.reg; name that apart from read failures.
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    skipped(code === "ENOENT" ? "missing-registry" : "unreadable-registry");
    return [];
  } finally {
    lines.close();
    input.destroy();
  }
  const roots = new Set<string>();
  for (const hit of paths) {
    // Strip a known flavor before resolving so the recorded flavor need not still exist.
    const segments = hit.path.split("\\");
    if (
      hit.installPath &&
      WOW_FLAVOR_FOLDERS.some((name) => name === segments.at(-1)?.toLowerCase())
    )
      segments.pop();
    const path = await translate(prefix, segments.join("\\"));
    if (path) roots.add(path);
  }
  return [...roots];
}

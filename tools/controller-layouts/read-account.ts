/** Local read-only inventory. Run on the Deck only when the parent authorizes it.
 * Does not print Steam settings, login tokens or controller file content. */
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { createHash } from "node:crypto";
import { readSteamShortcuts } from "../../backend/src/wow/installation/SteamShortcuts";
const [steamRoot, account] = process.argv.slice(2);
if (!steamRoot || !/^[1-9][0-9]{0,9}$/.test(account ?? ""))
  throw Error("Usage: bun tools/controller-layouts/read-account.ts Steam-root account-id");
const root = await realpath(steamRoot);
const config = join(root, "userdata", account!, "config");
const shortcutBytes = await readFile(join(config, "shortcuts.vdf"));
if (shortcutBytes.length > 16 * 1024 * 1024) throw Error("Shortcut list exceeds bound");
const shortcuts = readSteamShortcuts(shortcutBytes).map(({ appId, name }) => ({ appId, name }));
const files: { path: string; bytes: number; sha256: string }[] = [];
const inventory = async (path: string, depth: number) => {
  if (depth > 4 || files.length >= 2000) throw Error("Inventory exceeds bound");
  const canonical = await realpath(path);
  if (!canonical.startsWith(root + sep)) throw Error("Inventory leaves Steam root");
  const info = await stat(canonical);
  if (info.isDirectory()) {
    for (const name of (await readdir(canonical)).sort()) await inventory(join(canonical, name), depth + 1);
  } else if (info.isFile() && canonical.endsWith(".vdf")) {
    if (info.size > 16 * 1024 * 1024) throw Error("Config exceeds bound");
    files.push({ path: canonical.slice(root.length + 1), bytes: info.size,
      sha256: createHash("sha256").update(await readFile(canonical)).digest("hex") });
  }
};
for (const path of [join(root, "steamapps/common/Steam Controller Configs", account!),
  join(config, "localconfig.vdf"), join(config, "sharedconfig.vdf"), join(root, "config/config.vdf")]) {
  try { await inventory(path, 0); }
  catch (error) { if ((error as { code?: string }).code !== "ENOENT") throw error; }
}
console.log(JSON.stringify({ shortcuts, files, limitation: "Inventory only; no claim of selection-layer absence or shared-scope isolation" }, null, 2));

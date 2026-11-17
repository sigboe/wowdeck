import { realpath } from "node:fs/promises";
import { join } from "node:path";

/** Steam aliases must resolve to one account folder, never an arbitrary first match. */
export async function accountConfigRoot(homeDir: string, accountId: number) {
  if (!Number.isSafeInteger(accountId) || accountId <= 0 || accountId > 0xffffffff)
    throw Error("Couldn't establish this Steam account.");
  const roots = new Set<string>();
  for (const base of [".local/share/Steam", ".steam/steam"]) {
    try {
      roots.add(await realpath(join(homeDir, base,
        "steamapps/common/Steam Controller Configs", String(accountId), "config")));
    } catch { /* absent installation */ }
  }
  if (roots.size !== 1) throw Error("Couldn't establish this account's controller layout folder.");
  return [...roots][0]!;
}

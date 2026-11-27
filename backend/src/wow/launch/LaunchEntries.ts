import { realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  BATTLE_NET_LAUNCH_TARGET,
  BATTLE_NET_NAME,
  type BattleNetLaunchClient,
  type Installation,
  type WowLaunchClient,
} from "../../api/contracts";
import { WOW_CLIENTS, wowClientForFolder } from "../clients";
import type { InstallationDetector } from "../installation/InstallationDetector";
import { isWowShortcut, shortcutPrefixOverrides } from "../installation/SteamShortcuts";
import { isWowClientExecutable } from "../installation/WowExecutables";
import { battleNetInstalls } from "./BattleNetInstalls";
import type { LaunchIcons } from "./LaunchIcons";
import type { LaunchEntry } from "./LaunchService";

const canonical = (path: string) => realpath(path).catch(() => undefined);

/**
 * The launch entry for a Steam shortcut, or null when WoWDeck can't launch
 * through it. Whether the app id is a linked game is the caller's check
 * (LinkedGameList.isLinked in engine.ts).
 */
export async function resolveLaunchEntry(
  appId: number,
  installations: Installation[],
  steam: Pick<InstallationDetector, "steamLibraryFolders" | "steamShortcuts">,
  artwork: LaunchIcons,
  preferredId?: string,
): Promise<LaunchEntry | null> {
  const [shortcuts, folders] = await Promise.all([
    steam.steamShortcuts(),
    steam.steamLibraryFolders(),
  ]);
  const descriptions = shortcuts.filter((shortcut) => shortcut.appId === appId);
  const shortcut = descriptions[0];
  if (
    !shortcut ||
    !isWowShortcut(shortcut) ||
    descriptions.some(
      (other) => other.exe !== shortcut.exe || other.launchOptions !== shortcut.launchOptions,
    )
  )
    return null;

  const exe = basename(
    shortcut.exe
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replaceAll("\\", "/"),
  );
  if (isWowClientExecutable(exe)) return null;

  const libraries = [
    ...new Set((await Promise.all(folders.map(canonical))).filter((lib) => lib !== undefined)),
  ];
  const overrides = shortcutPrefixOverrides(shortcut);
  const candidates = overrides.length
    ? overrides
    : libraries.map((lib) => join(lib, "steamapps", "compatdata", String(appId), "pfx"));
  const prefixes = [
    ...new Set(
      (await Promise.all(candidates.map(canonical))).filter((prefix) => prefix !== undefined),
    ),
  ];
  // Proton's prefix is always `<compat data>/pfx`; anything else isn't the
  // prefix Steam's replay reaches.
  if (prefixes.length !== 1 || basename(prefixes[0]!) !== "pfx") return null;

  // Battle.net in that prefix decides which clients exist: a folder it
  // doesn't list (left behind, copied, or another prefix's) can't start.
  const installs = await battleNetInstalls(prefixes[0]!);
  if (!installs) return null;
  const listed = new Set(installs.map(({ path }) => path));
  const seen = new Set<string>();
  const present: Array<{ installation: Installation; path: string }> = [];
  for (const installation of installations) {
    const path = await canonical(installation.path);
    if (!path || !listed.has(path) || seen.has(path)) continue;
    seen.add(path);
    present.push({ installation, path });
  }
  if (!present.length) return null;

  // One row per Retail and Forever install, one Classic row for every
  // Classic version: WoWC starts whichever Battle.net has active.
  const rows: Row[] = [];
  for (const { installation, path } of present) {
    const client = wowClientForFolder(basename(installation.path).toLowerCase());
    if (!client?.launch || client.gameType !== installation.gameType) continue;
    const folder = { path, shortName: client.shortName, order: WOW_CLIENTS.indexOf(client) };
    const shared = client.launch.row && rows.find(({ client: row }) => row.id === client.launch!.row);
    if (shared) {
      shared.folders.push(folder);
      shared.ids.push(installation.id);
      continue;
    }
    rows.push({
      client: client.launch.row
        ? { kind: "wow", id: client.launch.row, name: CLASSIC_NAME, shortName: CLASSIC_SHORT_NAME }
        : { kind: "wow", id: installation.id, name: installation.clientFullName, shortName: installation.clientName },
      ids: [installation.id],
      product: client.launch.code,
      folders: [folder],
    });
  }
  for (const row of rows) row.folders.sort((a, b) => a.order - b.order);
  rows.sort((a, b) => a.folders[0]!.order - b.folders[0]!.order);

  const battleNet: BattleNetLaunchClient = {
    kind: "battlenet",
    id: BATTLE_NET_LAUNCH_TARGET,
    name: BATTLE_NET_NAME,
    shortName: BATTLE_NET_NAME,
  };
  // A saved Mists, Era or Anniversary installation is the Classic row; a
  // saved choice the entry no longer offers falls back to Battle.net.
  const chosen = preferredId === undefined
    ? undefined
    : rows.find(({ client, ids }) => client.id === preferredId || ids.includes(preferredId));
  for (const { client, folders, product } of rows) {
    artwork.register({ appId, prefix: prefixes[0]!, target: client.id, product, directory: folders[0]!.path });
  }
  return {
    appId,
    clients: [battleNet, ...rows.map(({ client }) => client)],
    target: chosen?.client ?? battleNet,
    ...(chosen && {
      targetFolders: chosen.folders.map(({ path, shortName }) => ({ path, shortName })),
      product: chosen.product,
    }),
    prefixes,
    libraries,
    iconActivity: () => artwork.retryMissing(prefixes[0]!),
    icons: Object.fromEntries([
      [battleNet.id, () => artwork.icon({ appId, prefix: prefixes[0]!, target: battleNet.id, product: "battlenet", executable: unquote(shortcut.exe) })],
      // Classic's icon is its first version's in table order: Mists, Era, Anniversary.
      ...rows.map(({ client, folders, product }) => [client.id, () => artwork.icon({ appId, prefix: prefixes[0]!, target: client.id, product, directory: folders[0]!.path })]),
    ]),
  };
}

const CLASSIC_NAME = "World of Warcraft Classic";
const CLASSIC_SHORT_NAME = "Classic";

interface Row {
  client: WowLaunchClient;
  /** The installations behind the row: what earlier pickers saved. */
  ids: string[];
  product: string;
  /** Its client folders, in client table order. */
  folders: Array<{ path: string; shortName: string; order: number }>;
}

const unquote = (path: string) => path.trim().replace(/^"(.*)"$/, "$1");

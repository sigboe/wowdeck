/**
 * The desktop's file manager over D-Bus (WF-20): the freedesktop
 * `org.freedesktop.FileManager1` interface, which Dolphin, Nautilus, Nemo,
 * Caja, Thunar and PCManFM implement.
 *
 * Only a file manager that is already running is used. The name is
 * D-Bus-activatable (SteamOS ships Dolphin's service file), so a plain call
 * would start one, on top of the game in Game Mode. `NameHasOwner` says
 * whether anyone holds the name now; the call itself goes out with
 * auto-start off, so one that quit in between fails instead of starting.
 *
 * Which bus: the user's own session bus first, then every other session bus
 * the user's processes name in DBUS_SESSION_BUS_ADDRESS. A nested desktop
 * (`dbus-run-session startplasma-wayland` in Game Mode) runs on a private
 * bus of its own, so its Dolphin is only found there (checked on a Deck).
 * Sandbox buses (Flatpak, pressure-vessel) are listed too but unreachable
 * from here; their calls fail and they are skipped. The engine inherits no
 * session-bus address from Decky, so the user bus is the standard one under
 * /run/user/<uid>.
 *
 * Dolphin gets its own call first: its ShowItems starts a new dolphin
 * process (under systemd, outside Steam's process tree), and gamescope only
 * shows windows whose process descends from the game Steam launched, so with
 * Dolphin added as a non-Steam game the new window was never visible (DEVICE
 * 2026-10-22). Its instance interface, `org.kde.dolphin-<pid>`
 * `openFiles`, opens the folders as a tab in the window that is already
 * there, the way Dolphin reuses a running instance itself. Other file
 * managers, or a Dolphin whose first window is gone, get ShowItems.
 *
 * Calls go through `busctl` (systemd), present wherever a Steam session is;
 * without it nothing is running as far as this module can tell.
 */

import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import type { FileManagerState } from "../api/contracts";
import { fsProcReader, type ProcReader } from "../wow/wtf/GameProcessGuard";

const NAME = "org.freedesktop.FileManager1";
const CALL_TIMEOUT_MS = 5_000;

/** Runs `busctl --address=<address> <args>`; stdout, or null when the call failed (or busctl is missing). */
export type BusCtl = (address: string, args: string[]) => Promise<string | null>;

export const busctl: BusCtl = (address, args) =>
  new Promise((resolve) => {
    execFile("busctl", [`--address=${address}`, ...args], { timeout: CALL_TIMEOUT_MS }, (err, stdout) =>
      resolve(err ? null : stdout),
    );
  });

export interface Desktop {
  bus: BusCtl;
  proc: ProcReader;
  /** The user's own session bus address. */
  userBus: string;
}

const desktop: Desktop = {
  bus: busctl,
  proc: fsProcReader,
  userBus: process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=/run/user/${process.getuid?.() ?? 1000}/bus`,
};

/**
 * Session buses to look on: the user bus, then each other address the
 * user's processes carry (another user's environ is unreadable, so only
 * buses of this user), in first-seen order.
 */
export async function sessionBuses({ proc, userBus }: Pick<Desktop, "proc" | "userBus">): Promise<string[]> {
  const buses = new Set([userBus]);
  const environs = await Promise.all(((await proc.pids()) ?? []).map((pid) => proc.read(pid, "environ")));
  for (const environ of environs) {
    const entry = environ?.split("\0").find((e) => e.startsWith("DBUS_SESSION_BUS_ADDRESS="));
    if (entry) {
      buses.add(entry.slice("DBUS_SESSION_BUS_ADDRESS=".length));
    }
  }
  return [...buses];
}

/**
 * The running file manager: the first session bus where one holds
 * FileManager1, with its program name and Steam app read from its process.
 */
async function findFileManager(d: Desktop): Promise<(FileManagerState & { address: string; pid: string | null }) | null> {
  for (const address of await sessionBuses(d)) {
    const owned = await d.bus(address, ["call", "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "NameHasOwner", "s", NAME]);
    if (owned?.trim() !== "b true") {
      continue;
    }
    const reply = await d.bus(address, ["call", "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "GetConnectionUnixProcessID", "s", NAME]);
    const pid = reply?.trim().match(/^u (\d+)$/)?.[1];
    const program = pid ? (await d.proc.read(pid, "comm"))?.trim() : null;
    const appId = pid ? (await d.proc.read(pid, "environ"))?.split("\0").find((e) => e.startsWith("SteamAppId=")) : undefined;
    const steamAppId = Number(appId?.slice("SteamAppId=".length));
    return {
      address,
      pid: pid ?? null,
      running: true,
      name: program ? program.charAt(0).toUpperCase() + program.slice(1) : null,
      steamAppId: Number.isSafeInteger(steamAppId) && steamAppId > 0 ? steamAppId : null,
    };
  }
  return null;
}

/** Whether a file manager is running on one of the user's session buses, and which. */
export async function runningFileManager(d: Desktop = desktop): Promise<FileManagerState> {
  const found = await findFileManager(d);
  return found ? { running: true, name: found.name, steamAppId: found.steamAppId } : { running: false, name: null, steamAppId: null };
}

/**
 * Opens the running file manager with these paths selected (their parent
 * folder shown), and says which Steam app it runs under. `shown` false when
 * none is running: nothing is started.
 */
export async function showItems(paths: string[], d: Desktop = desktop): Promise<{ shown: boolean; steamAppId: number | null }> {
  const found = await findFileManager(d);
  if (!found) {
    return { shown: false, steamAppId: null };
  }
  const uris = paths.map((p) => pathToFileURL(p).href);
  const inDolphin =
    found.pid &&
    (await d.bus(found.address, [
      "--auto-start=no",
      "call",
      `org.kde.dolphin-${found.pid}`,
      "/dolphin/Dolphin_1",
      "org.kde.dolphin.MainWindow",
      "openFiles",
      "asb",
      String(uris.length),
      ...uris,
      "false",
    ])) !== null;
  if (inDolphin) {
    return { shown: true, steamAppId: found.steamAppId };
  }
  const out = await d.bus(found.address, [
    "--auto-start=no",
    "call",
    NAME,
    "/org/freedesktop/FileManager1",
    NAME,
    "ShowItems",
    "ass",
    String(uris.length),
    ...uris,
    "",
  ]);
  return out !== null ? { shown: true, steamAppId: found.steamAppId } : { shown: false, steamAppId: null };
}

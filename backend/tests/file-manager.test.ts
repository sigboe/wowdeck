import { describe, expect, test } from "bun:test";
import { runningFileManager, sessionBuses, showItems, type Desktop } from "../src/desktop/FileManager";

const USER_BUS = "unix:path=/run/user/1000/bus";
const NESTED_BUS = "unix:path=/tmp/dbus-nested,guid=abc";

/**
 * A fake desktop: processes with environs and comms, and buses that answer
 * by method name (a bus not listed fails, like an unreachable sandbox bus).
 * Records every bus call.
 */
function fakeDesktop(
  buses: Record<string, Record<string, string | null>>,
  processes: Record<string, { environ?: string[]; comm?: string }> = {},
): Desktop & { calls: Array<{ address: string; args: string[] }> } {
  const calls: Array<{ address: string; args: string[] }> = [];
  return {
    calls,
    userBus: USER_BUS,
    bus: async (address, args) => {
      calls.push({ address, args });
      const method = args[args.indexOf("call") + 4]!;
      const answers = buses[address];
      return answers && method in answers ? answers[method]! : null;
    },
    proc: {
      pids: async () => Object.keys(processes),
      read: async (pid, file) => {
        const p = processes[pid];
        if (file === "environ") {
          return p?.environ ? p.environ.join("\0") + "\0" : null;
        }
        return file === "comm" && p?.comm ? `${p.comm}\n` : null;
      },
    },
  };
}

describe("sessionBuses", () => {
  test("the user bus first, then each other bus the user's processes name, once", async () => {
    const d = fakeDesktop({}, {
      "10": { environ: ["HOME=/home/deck", `DBUS_SESSION_BUS_ADDRESS=${USER_BUS}`] },
      "20": { environ: [`DBUS_SESSION_BUS_ADDRESS=${NESTED_BUS}`] },
      "21": { environ: [`DBUS_SESSION_BUS_ADDRESS=${NESTED_BUS}`] },
      "30": {}, // another user's process: environ unreadable
    });
    expect(await sessionBuses(d)).toEqual([USER_BUS, NESTED_BUS]);
  });
});

describe("runningFileManager", () => {
  test("names the program that owns FileManager1 on the user bus", async () => {
    const d = fakeDesktop(
      { [USER_BUS]: { NameHasOwner: "b true\n", GetConnectionUnixProcessID: "u 4242\n" } },
      { "4242": { comm: "dolphin" } },
    );
    expect(await runningFileManager(d)).toEqual({ running: true, name: "Dolphin", steamAppId: null });
  });

  test("the Steam app it runs under: Dolphin added as a non-Steam game", async () => {
    const d = fakeDesktop(
      { [USER_BUS]: { NameHasOwner: "b true", GetConnectionUnixProcessID: "u 13351" } },
      { "13351": { comm: "dolphin", environ: ["DISPLAY=:1", "SteamAppId=4276264303", `DBUS_SESSION_BUS_ADDRESS=${USER_BUS}`] } },
    );
    expect(await runningFileManager(d)).toEqual({ running: true, name: "Dolphin", steamAppId: 4276264303 });
  });

  test("finds a nested desktop's file manager on its private bus", async () => {
    const d = fakeDesktop(
      {
        [USER_BUS]: { NameHasOwner: "b false" },
        [NESTED_BUS]: { NameHasOwner: "b true", GetConnectionUnixProcessID: "u 5282" },
      },
      {
        "5282": { comm: "dolphin", environ: [`DBUS_SESSION_BUS_ADDRESS=${NESTED_BUS}`] },
        "40": { environ: ["DBUS_SESSION_BUS_ADDRESS=unix:path=/run/flatpak/bus"] },
      },
    );
    expect(await runningFileManager(d)).toEqual({ running: true, name: "Dolphin", steamAppId: null });
  });

  test("running without a name when the owner's program can't be read", async () => {
    const d = fakeDesktop({ [USER_BUS]: { NameHasOwner: "b true", GetConnectionUnixProcessID: null } });
    expect(await runningFileManager(d)).toEqual({ running: true, name: null, steamAppId: null });
  });

  test("not running when no bus has an owner, or none can be asked", async () => {
    for (const owned of ["b false", null]) {
      const d = fakeDesktop({ [USER_BUS]: { NameHasOwner: owned } }, {
        "40": { environ: ["DBUS_SESSION_BUS_ADDRESS=unix:path=/run/flatpak/bus"] },
      });
      expect(await runningFileManager(d)).toEqual({ running: false, name: null, steamAppId: null });
    }
  });
});

describe("showItems", () => {
  test("calls ShowItems on the owner's bus with file URIs and auto-start off", async () => {
    const d = fakeDesktop(
      { [USER_BUS]: { NameHasOwner: "b false" }, [NESTED_BUS]: { NameHasOwner: "b true", GetConnectionUnixProcessID: "u 5282", ShowItems: "" } },
      { "5282": { environ: [`DBUS_SESSION_BUS_ADDRESS=${NESTED_BUS}`, "SteamAppId=3000000001"] } },
    );
    expect(await showItems(["/home/deck/Wo W/AddOns/DBM-Core", "/a/B"], d)).toEqual({ shown: true, steamAppId: 3000000001 });
    expect(d.calls.at(-1)).toEqual({
      address: NESTED_BUS,
      args: [
        "--auto-start=no",
        "call",
        "org.freedesktop.FileManager1",
        "/org/freedesktop/FileManager1",
        "org.freedesktop.FileManager1",
        "ShowItems",
        "ass",
        "2",
        "file:///home/deck/Wo%20W/AddOns/DBM-Core",
        "file:///a/B",
        "",
      ],
    });
  });

  test("a Dolphin instance opens them as a tab in its own window, no ShowItems (gamescope shows only that window)", async () => {
    const d = fakeDesktop(
      { [USER_BUS]: { NameHasOwner: "b true", GetConnectionUnixProcessID: "u 13351", openFiles: "", ShowItems: "" } },
      { "13351": { comm: "dolphin", environ: ["SteamAppId=4276264303"] } },
    );
    expect(await showItems(["/w/AddOns/DBM-Core"], d)).toEqual({ shown: true, steamAppId: 4276264303 });
    expect(d.calls.at(-1)).toEqual({
      address: USER_BUS,
      args: [
        "--auto-start=no",
        "call",
        "org.kde.dolphin-13351",
        "/dolphin/Dolphin_1",
        "org.kde.dolphin.MainWindow",
        "openFiles",
        "asb",
        "1",
        "file:///w/AddOns/DBM-Core",
        "false",
      ],
    });
    expect(d.calls.some((c) => c.args.includes("ShowItems"))).toBe(false);
  });

  test("false, and no ShowItems call, when no file manager is running", async () => {
    const d = fakeDesktop({ [USER_BUS]: { NameHasOwner: "b false", ShowItems: "" } });
    expect(await showItems(["/a"], d)).toEqual({ shown: false, steamAppId: null });
    expect(d.calls.some((c) => c.args.includes("ShowItems"))).toBe(false);
  });

  test("false when the call fails (the file manager quit in between)", async () => {
    const d = fakeDesktop({ [USER_BUS]: { NameHasOwner: "b true", GetConnectionUnixProcessID: "u 7", ShowItems: null } });
    expect(await showItems(["/a"], d)).toEqual({ shown: false, steamAppId: null });
  });
});

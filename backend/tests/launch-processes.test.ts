import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localLaunchWorld, observeLaunch, type LaunchProcess } from "../src/wow/launch/LaunchProcesses";
import type { LaunchEntry, Replay } from "../src/wow/launch/LaunchService";

const home = "/home/deck";
const steam = home + "/.local/share/Steam";
const prefix = steam + "/steamapps/compatdata/123/pfx";
const runtime = steam + "/steamapps/common/SteamLinuxRuntime_4/_v2-entry-point";
const proton = steam + "/compatibilitytools.d/GE-Proton/proton";
const battle = prefix + "/drive_c/Program Files (x86)/Battle.net/Battle.net.exe";
const reaper = steam + "/steamrt64/reaper";
const target = { kind: "wow", id: "forever", name: "Forever", shortName: "Forever" } as const;
const entry: LaunchEntry = {
  appId: 123, clients: [target], target, targetFolders: [{ path: "/games/wow/_forever_", shortName: "Forever" }], product: "WoWF",
  prefixes: [prefix], libraries: [steam],
};
const launcher: LaunchProcess = {
  pid: 1, executable: reaper,
  argv: [reaper, "SteamLaunch", "--", runtime, "--verb=waitforexitandrun", "--", proton, "waitforexitandrun", battle, "--exec=launch WoW", "--other"],
  env: new Map([
    ["STEAM_COMPAT_DATA_PATH", prefix.slice(0, -4)],
    ["STEAM_COMPAT_TOOL_PATHS", [proton.slice(0, -7), runtime.slice(0, runtime.lastIndexOf("/"))].join(":")],
    ["LD_PRELOAD", "bad"], ["SECRET_TOKEN", "private"], ["HOME", home],
  ]),
};
const renderer: LaunchProcess = {
  pid: 2, executable: proton.replace(/\/proton$/, "/files/lib/wine/i386-unix/wine-preloader"),
  argv: ["C:\\Program Files (x86)\\Battle.net\\Battle.net.exe", "--type=renderer"],
  env: new Map([["WINEPREFIX", prefix]]),
};
const observe = (processes: LaunchProcess[]) => observeLaunch(entry, processes, [steam], home, async (path) => path);

test("replay builds a fresh argv for the approved launcher and drops inherited options", async () => {
  const result = await observe([launcher, renderer]);
  expect(result.renderer).toBe(2);
  expect(result.replay?.argv).toEqual([runtime, "--verb=run", "--", proton, "run", battle, "--exec=launch WoWF"]);
  expect(result.replay?.env).not.toHaveProperty("LD_PRELOAD");
  expect(result.replay?.env).not.toHaveProperty("SECRET_TOKEN");
});

test("other prefixes, an untrusted runtime path and a different install cannot authorize an ask", async () => {
  const foreign = { ...renderer, env: new Map([["WINEPREFIX", "/other/pfx"]]) };
  expect((await observe([launcher, foreign])).renderer).toBeNull();
  expect((await observe([{ ...launcher, argv: launcher.argv.map(arg => arg === runtime ? "/tmp/_v2-entry-point" : arg) }, renderer])).replay).toBeUndefined();
  const otherWow = { ...renderer, argv: ["Z:\\other\\_forever_\\Wow.exe"] };
  expect(await observe([launcher, renderer, otherWow])).toMatchObject({ targetRunning: null, gameRunning: "running" });
  const ownWow = { ...renderer, argv: ["Z:\\games\\wow\\_forever_\\Wow.exe"] };
  expect(await observe([launcher, renderer, ownWow])).toMatchObject({ targetRunning: "/games/wow/_forever_" });
});

test("a Steam reaper for a different shortcut cannot replay into a shared prefix", async () => {
  const shared = { ...launcher, env: new Map([...launcher.env, ["SteamAppId", "456"]]) };
  expect((await observe([shared, renderer])).replay).toBeUndefined();
});

test("a replay can be released only when the original launcher and its prefix are idle", async () => {
  const { replayCanStop } = await import("../src/wow/launch/LaunchProcesses");
  const plan = (await observe([launcher, renderer])).replay!;
  const samePrefixWow = { ...renderer, argv: ["Z:\\games\\wow\\_forever_\\Wow.exe"] };
  expect(await replayCanStop(plan, [launcher], async (path) => path)).toBe(false);
  expect(await replayCanStop(plan, [renderer], async (path) => path)).toBe(false);
  expect(await replayCanStop(plan, [samePrefixWow], async (path) => path)).toBe(false);
  expect(await replayCanStop(plan, null, async (path) => path)).toBe(false);
  expect(await replayCanStop(plan, [], async (path) => path)).toBe(true);
});

test("the runtime bwrap preflight failure proves replay startup failed", async () => {
  await replayFixture(async (ask) => {
    expect(await ask("bwrap: execvp true: No such file or directory", 1)).toBe(true);
    expect(await ask(
      "pressure-vessel-wrap[42]: E: Child process exited with code 1: bwrap: execvp true: No such file or directory", 1,
    )).toBe(true);
  });
});

test("a replay exit code, generic launcher error or signal leaves delivery uncertain", async () => {
  await replayFixture(async (ask) => {
    expect(await ask("Battle.net could not start WoW", 1)).toBe(false);
    expect(await ask("", 1)).toBe(false);
    expect(await ask("bwrap: execvp true: No such file or directory", 0)).toBe(false);
    expect(await ask("", "signal")).toBe(false);
  });
});

test("a runtime entry point missing readlink proves the request never reached Battle.net", async () => {
  await replayFixture(async (ask) => {
    expect(await ask(`${runtime}: line 6: readlink: command not found`, 127)).toBe(true);
    expect(await ask(`${runtime}: 6: readlink: not found`, 127)).toBe(true);
    expect(await ask("nsenter: reassociate to namespaces failed: Operation not permitted", 1)).toBe(true);
    expect(await ask(`${runtime}: line 6: readlink: command not found`, 0)).toBe(false);
  });
});

test("replay reaches its runtime inside Steam's mount namespace with credentials preserved", async () => {
  const root = await mkdtemp(join(tmpdir(), "wowdeck-namespace-"));
  const runtime = join(root, "_v2-entry-point");
  const proton = join(root, "proton");
  const battle = join(root, "Battle.net.exe");
  const nsenter = join(root, "nsenter");
  const delivered = join(root, "delivered");
  const replay: Replay = {
    reaperPid: process.pid, prefix: root,
    argv: [runtime, "--verb=run", "--", proton, "run", battle, "--exec=launch WoWF"], env: {},
  };
  try {
    await writeFile(proton, "", { mode: 0o700 });
    await writeFile(battle, "");
    await writeFile(runtime, `#!/bin/sh\n[ "$TEST_NAMESPACE" = steam ] || exit 127\nprintf delivered > '${delivered}'\n`, { mode: 0o700 });
    await writeFile(nsenter, `#!/bin/sh
[ "$1" = --target ] && [ "$2" = '${process.pid}' ] && [ "$3" = --user ] && [ "$4" = --mount ] && [ "$5" = --preserve-credentials ] && [ "$6" = -- ] || exit 1
shift 6
export TEST_NAMESPACE=steam
exec "$@"
`, { mode: 0o700 });
    const world = localLaunchWorld(root, () => [], {
      namespace: async (pid) => pid === "self" ? "host" : "steam",
      findExecutable: (name) => name === "nsenter" ? nsenter : null,
    });
    await (await world.ask(replay))?.startupFailed;
    expect(await readFile(delivered, "utf8").catch(() => null)).toBe("delivered");
    await rm(delivered);
    const servicePath = localLaunchWorld(root, () => [], {
      namespace: async (pid) => pid === "self" ? "host" : "steam",
      findExecutable: (name) => name === "/run/current-system/sw/bin/nsenter" ? nsenter : null,
    });
    await (await servicePath.ask(replay))?.startupFailed;
    expect(await readFile(delivered, "utf8").catch(() => null)).toBe("delivered");
    const missingHelper = localLaunchWorld(root, () => [], {
      namespace: async (pid) => pid === "self" ? "host" : "steam",
      findExecutable: () => null,
    });
    expect(await missingHelper.ask(replay)).toBeNull();
    await writeFile(runtime, `#!/bin/sh\nprintf direct > '${delivered}'\n`, { mode: 0o700 });
    const sameUser = localLaunchWorld(root, () => [], {
      namespace: async (pid, kind) => kind === "user" ? "shared-user" : String(pid),
      findExecutable: () => { throw new Error("A shared user namespace must not need nsenter"); },
    });
    await (await sameUser.ask(replay))?.startupFailed;
    expect(await readFile(delivered, "utf8")).toBe("direct");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function replayFixture(run: (
  ask: (diagnostic: string, exit: number | "signal") => Promise<boolean | undefined>,
) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "wowdeck-replay-"));
  const runtime = join(root, "_v2-entry-point");
  const proton = join(root, "proton");
  const battle = join(root, "Battle.net.exe");
  const replay: Replay = {
    reaperPid: process.pid,
    prefix: root,
    argv: [runtime, "--verb=run", "--", proton, "run", battle],
    env: {},
  };
  const world = localLaunchWorld(root, () => []);
  try {
    await writeFile(proton, "", { mode: 0o700 });
    await writeFile(battle, "");
    await run(async (diagnostic, exit) => {
      const end = exit === "signal" ? 'kill -TERM "$$"' : `exit ${exit}`;
      await writeFile(runtime, `#!/bin/sh\nprintf '%s\\n' '${diagnostic}' >&2\n${end}\n`, { mode: 0o700 });
      return (await world.ask(replay))?.startupFailed;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

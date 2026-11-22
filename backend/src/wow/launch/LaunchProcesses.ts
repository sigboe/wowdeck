import { access, readFile, readdir, readlink, realpath, stat } from "node:fs/promises";
import { X_OK } from "node:constants";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { isWowClientExecutable } from "../installation/WowExecutables";
import type { LaunchEntry, LaunchWorld, Observation, Replay } from "./LaunchService";

export interface LaunchProcess {
  pid: number;
  executable: string;
  argv: string[];
  env: Map<string, string>;
}

type ResolvePath = (path: string) => Promise<string | undefined>;

interface ReplayHost {
  namespace(pid: number | "self", kind: "mnt" | "user"): Promise<string>;
  findExecutable(name: string): string | null;
}

const replayHost: ReplayHost = {
  namespace: (pid, kind) => readlink(`/proc/${pid}/ns/${kind}`),
  findExecutable: (name) => Bun.which(name),
};

const filename = (path: string) => basename(path.replaceAll("\\", "/")).toLowerCase();

function winePath(value: string, prefix: string): string | undefined {
  const path = value.replaceAll("\\", "/");
  if (/^z:\//i.test(path)) return path.slice(2);
  if (/^c:\//i.test(path)) return join(prefix, "drive_c", path.slice(2));
  return isAbsolute(path) ? path : undefined;
}

function within(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && !isAbsolute(path) && path !== ".." && !path.startsWith("../");
}

function environment(process: LaunchProcess, home: string, data: string, tools: string[]): Record<string, string> {
  const env: Record<string, string> = {
    HOME: home,
    PATH: "/usr/bin:/bin",
    STEAM_COMPAT_DATA_PATH: data,
    STEAM_COMPAT_TOOL_PATHS: tools.join(":"),
  };
  for (const name of [
    "USER", "LOGNAME", "LANG", "LC_ALL", "DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY",
    "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "PULSE_SERVER", "SteamAppId", "SteamGameId",
    "STEAM_COMPAT_APP_ID",
  ]) {
    const value = process.env.get(name);
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function steamReaper(executable: string, steamHomes: string[]): string | undefined {
  return steamHomes.find((root) =>
    ["steamrt64", "ubuntu12_32"].some((directory) => executable === join(root, directory, "reaper")));
}

async function replayFor(
  process: LaunchProcess,
  entry: LaunchEntry,
  prefix: string,
  steamHomes: string[],
  home: string,
  resolve: ResolvePath,
): Promise<Replay | undefined> {
  const product = entry.product;
  const data = process.env.get("STEAM_COMPAT_DATA_PATH");
  if (!product || !data || await resolve(data) !== dirname(prefix) || await resolve(join(data, "pfx")) !== prefix) return;

  const appId = String(entry.appId);
  const steamAppId = process.env.get("SteamAppId");
  const shortcutId = process.env.get("SteamGameId");
  if (steamAppId && steamAppId !== "0" && steamAppId !== appId) return;
  if (shortcutId && shortcutId !== "0" && shortcutId !== appId &&
      shortcutId !== ((BigInt(entry.appId) << 32n) | 0x02000000n).toString()) return;
  if ((!steamAppId || steamAppId === "0") && (!shortcutId || shortcutId === "0") && basename(data) !== appId) return;
  const steamHome = steamReaper(process.executable, steamHomes);
  if (!steamHome) return;

  const marker = process.argv.findIndex((arg) => basename(arg) === "_v2-entry-point");
  if (marker < 1) return;
  const [runtimeArg, runtimeVerb, separator, protonArg, protonVerb, battleArg] = process.argv.slice(marker);
  if (!runtimeArg || !protonArg || !battleArg || runtimeVerb !== "--verb=waitforexitandrun" ||
      separator !== "--" || protonVerb !== "waitforexitandrun") return;
  const battlePath = winePath(battleArg, prefix);
  if (!battlePath || !["battle.net.exe", "battle.net launcher.exe"].includes(filename(battlePath))) return;

  const [runtime, proton, battle, driveC] = await Promise.all([
    resolve(runtimeArg), resolve(protonArg), resolve(battlePath), resolve(join(prefix, "drive_c")),
  ]);
  if (!runtime || !proton || !battle || !driveC || !within(driveC, battle) ||
      basename(runtime) !== "_v2-entry-point" || basename(proton) !== "proton") return;

  const runtimeDir = dirname(runtime);
  const protonDir = dirname(proton);
  if (!entry.libraries.some((lib) => dirname(runtimeDir) === join(lib, "steamapps/common")) ||
      !/^SteamLinuxRuntime(?:_[a-z0-9]+)?$/i.test(basename(runtimeDir))) return;
  if (!entry.libraries.some((lib) => dirname(protonDir) === join(lib, "steamapps/common")) &&
      !steamHomes.some((root) => dirname(protonDir) === join(root, "compatibilitytools.d"))) return;

  const tools = await Promise.all((process.env.get("STEAM_COMPAT_TOOL_PATHS") ?? "").split(":").map(resolve));
  if (tools.length !== 2 || !tools.includes(runtimeDir) || !tools.includes(protonDir)) return;

  const env = environment(process, home, dirname(prefix), tools as string[]);
  env.STEAM_COMPAT_CLIENT_INSTALL_PATH = steamHome;
  return { reaperPid: process.pid, prefix, argv: [runtime, "--verb=run", "--", proton, "run", battle, `--exec=launch ${product}`], env };
}

export async function observeLaunch(
  entry: LaunchEntry, processes: LaunchProcess[], steamHomes: string[], home: string, resolve: ResolvePath,
): Promise<Observation> {
  const observed: Observation = { entryRunning: false, renderer: null, gameRunning: "not_running", targetRunning: null };
  const sessions = new Map<string, { renderers: number[]; reapers: LaunchProcess[] }>();
  for (const process of processes) {
    const first = process.argv[0] ?? "";
    const name = filename(first);
    const game = isWowClientExecutable(name);
    const battle = name === "battle.net.exe";
    const reaper = steamReaper(process.executable, steamHomes) !== undefined;
    if (game) observed.gameRunning = "running";
    if (!game && !battle && !reaper) continue;

    const data = process.env.get("STEAM_COMPAT_DATA_PATH");
    const path = reaper ? (data && join(data, "pfx")) : process.env.get("WINEPREFIX");
    const prefix = path ? await resolve(path) : undefined;
    if (!prefix || !entry.prefixes.includes(prefix)) continue;
    if (game) {
      const exe = winePath(first, prefix);
      const actual = exe ? await resolve(exe) : undefined;
      const folder = actual && entry.targetFolders?.find(({ path }) => path === dirname(actual));
      if (folder) observed.targetRunning = folder.path;
      continue;
    }

    const session = sessions.get(prefix) ?? { renderers: [], reapers: [] };
    sessions.set(prefix, session);
    if (reaper) session.reapers.push(process);
    if (battle && process.argv.includes("--type=renderer")) session.renderers.push(process.pid);
  }

  if (sessions.size !== 1) return observed;
  const [prefix, session] = sessions.entries().next().value!;
  observed.entryRunning = true;
  observed.renderer = session.renderers.sort((a, b) => a - b)[0] ?? null;
  const plans = (await Promise.all(
    session.reapers.map((process) => replayFor(process, entry, prefix, steamHomes, home, resolve)),
  )).filter((plan) => plan !== undefined);
  if (plans.length === 1) observed.replay = plans[0];
  return observed;
}

async function resolveLocal(path: string): Promise<string | undefined> {
  if (!isAbsolute(path)) return;
  return realpath(path).catch(() => undefined);
}

async function readProcesses(): Promise<LaunchProcess[] | null> {
  const uid = process.getuid?.();
  if (!uid) return null;
  const pids = await readdir("/proc").catch(() => null);
  if (!pids) return null;

  const results: LaunchProcess[] = [];
  for (let offset = 0; offset < pids.length; offset += 32) {
    await Promise.all(pids.slice(offset, offset + 32).filter((pid) => /^\d+$/.test(pid)).map(async (pid) => {
      const dir = `/proc/${pid}`;
      try {
        if ((await stat(dir)).uid !== uid) return;
        const argv = (await readFile(join(dir, "cmdline"), "utf8")).split("\0");
        const name = filename(argv[0] ?? "");
        if (!isWowClientExecutable(name) && name !== "battle.net.exe" && name !== "reaper") return;
        const [environ, executable] = await Promise.all([
          readFile(join(dir, "environ"), "utf8").catch(() => ""),
          realpath(join(dir, "exe")).catch(() => ""),
        ]);
        const env = new Map<string, string>();
        for (const pair of environ.split("\0")) {
          const index = pair.indexOf("=");
          if (index > 0) env.set(pair.slice(0, index), pair.slice(index + 1));
        }
        results.push({ pid: Number(pid), executable, argv, env });
      } catch {
        // Processes can exit during a scan.
      }
    }));
  }
  return results;
}

export async function replayCanStop(replay: Replay, processes: LaunchProcess[] | null, resolve: ResolvePath): Promise<boolean> {
  if (!processes) return false;
  for (const process of processes) {
    if (process.pid === replay.reaperPid) return false;
    const name = filename(process.argv[0] ?? "");
    if (name !== "battle.net.exe" && !isWowClientExecutable(name)) continue;
    const prefix = process.env.get("WINEPREFIX");
    if (!prefix || await resolve(prefix) === replay.prefix) return false;
  }
  return true;
}

/** GE's replay steam.exe can wait after Steam has stopped the shortcut. */
function releaseWithSession(child: ReturnType<typeof Bun.spawn>, replay: Replay): void {
  let checking = false;
  const timer = setInterval(async () => {
    if (checking) return;
    checking = true;
    try {
      if (await stat(`/proc/${replay.reaperPid}`).then(() => true, () => false)) return;
      if (await replayCanStop(replay, await readProcesses(), resolveLocal)) child.kill();
    } catch {
      // The replay can exit naturally between the scan and the signal.
    } finally {
      checking = false;
    }
  }, 5000);
  timer.unref();
  void child.exited.then(
    () => clearInterval(timer),
    () => clearInterval(timer),
  );
}

/** The runtime runs a bwrap preflight with `true` before invoking Proton. */
async function replayStartupFailed(
  stderr: ReadableStream<Uint8Array>,
  exited: Promise<number>,
): Promise<boolean> {
  // Drain the pipe so the child cannot block. Keep only a bounded diagnostic
  // prefix and never log its contents.
  const prefix = new Uint8Array(16 * 1024);
  let used = 0;
  try {
    for await (const chunk of stderr) {
      const available = Math.min(chunk.length, prefix.length - used);
      prefix.set(chunk.subarray(0, available), used);
      used += available;
    }
    const code = await exited;
    const diagnostic = new TextDecoder().decode(prefix.subarray(0, used));
    const failedPreflight = /^(?:pressure-vessel-wrap\[\d+\]: E: Child process exited with code \d+: )?bwrap: execvp true: No such file or directory\r?$/m;
    const missingRuntimeTool = /^.*\/_v2-entry-point: (?:line \d+: |\d+: )[^\r\n:]+: (?:command )?not found\r?$/m;
    const failedNamespace = /^nsenter: (?:reassociate to namespaces failed|setgroups failed|cannot open [^\r\n]*namespace)[^\r\n]*$/m;
    return code > 0 && (failedPreflight.test(diagnostic) || missingRuntimeTool.test(diagnostic) || failedNamespace.test(diagnostic));
  } catch {
    return false;
  }
}

export function localLaunchWorld(home: string, getSteamHomes: () => string[], host: ReplayHost = replayHost): LaunchWorld {
  return {
    now: () => performance.now(),
    wait: () => Bun.sleep(1000),
    async observe(entry) {
      const [processes, homes] = await Promise.all([
        readProcesses(),
        Promise.all(getSteamHomes().map(resolveLocal)),
      ]);
      if (!processes) return { entryRunning: false, renderer: null, targetRunning: null, gameRunning: "unknown" };
      return observeLaunch(entry, processes, homes.filter((path) => path !== undefined), home, resolveLocal);
    },
    async ask(replay) {
      if (!replay) return null;
      try {
        const [battle] = await Promise.all([
          stat(replay.argv[5]!), access(replay.argv[0]!, X_OK), access(replay.argv[3]!, X_OK),
        ]);
        if (!battle.isFile()) return null;
        const [ownNamespace, steamNamespace] = await Promise.all([
          host.namespace("self", "mnt"), host.namespace(replay.reaperPid, "mnt"),
        ]);
        let argv = replay.argv;
        if (ownNamespace !== steamNamespace) {
          const [ownUser, steamUser] = await Promise.all([
            host.namespace("self", "user"), host.namespace(replay.reaperPid, "user"),
          ]);
          // NixOS Steam has its own user and FHS mount namespaces. A
          // mount-only difference (e.g. PrivateTmp) needs no user entry.
          if (ownUser !== steamUser) {
            // Decky's service PATH can omit system utilities even when the
            // login shell has them. These are host tools, never prefix data.
            const nsenter = ["nsenter", "/usr/bin/nsenter", "/bin/nsenter", "/run/current-system/sw/bin/nsenter"]
              .map((name) => host.findExecutable(name)).find((path) => path !== null);
            if (!nsenter) return null;
            argv = [nsenter, "--target", String(replay.reaperPid), "--user", "--mount", "--preserve-credentials", "--", ...argv];
          }
        }
        const child = Bun.spawn(argv, {
          cwd: home, env: replay.env, stdin: "ignore", stdout: "ignore", stderr: "pipe",
        });
        releaseWithSession(child, replay);
        child.unref();
        return { startupFailed: replayStartupFailed(child.stderr, child.exited) };
      } catch {
        return null;
      }
    },
  };
}

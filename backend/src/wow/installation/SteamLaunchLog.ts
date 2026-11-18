import { watch, type FSWatcher } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { join } from "node:path";

const LOG = "console-linux.txt";
const READ_LIMIT = 256 * 1024;

type Launch = { appId: number; accountId?: number };

export class SteamLaunchLog {
  private readonly active = new Map<number, Launch>();
  private watchers: FSWatcher[] = [];
  private generation = 0;

  constructor(
    private readonly homeDir: string,
    private readonly record: (launch: Launch, pid?: string) => Promise<boolean>,
  ) {}

  async update(launch: Launch, running: boolean): Promise<void> {
    if (!running) {
      this.stopApp(launch.appId);
      return;
    }
    if (this.active.has(launch.appId)) return;
    this.active.set(launch.appId, launch);
    if (this.active.size === 1) await this.start(this.generation);
    await this.check(launch);
  }

  private stop(launch: Launch): void {
    if (this.active.get(launch.appId) !== launch) return;
    this.active.delete(launch.appId);
    if (this.active.size === 0) {
      this.generation++;
      for (const watcher of this.watchers) watcher.close();
      this.watchers = [];
    }
  }

  private async check(launch: Launch, pid?: string): Promise<void> {
    if (this.active.get(launch.appId) !== launch) return;
    if (await this.record(launch, pid)) this.stop(launch);
  }

  private async start(generation: number): Promise<void> {
    const dirs = await Promise.all([".local/share/Steam/logs", ".steam/steam/logs"].map(
      (root) => realpath(join(this.homeDir, root)).catch(() => undefined),
    ));
    for (const dir of new Set(dirs)) {
      if (!dir || generation !== this.generation) continue;
      await this.follow(dir, generation).catch(() => {});
    }
  }

  private async follow(dir: string, generation: number): Promise<void> {
    const path = join(dir, LOG);
    const initial = await stat(path).catch(() => undefined);
    if (generation !== this.generation) return;
    let inode = initial?.ino;
    let offset = initial?.size ?? 0;
    let pending = "";
    let changed = false;
    let reading = false;

    const drain = async () => {
      changed = true;
      if (reading) return;
      reading = true;
      try {
        while (changed && generation === this.generation) {
          changed = false;
          const file = await open(path, "r").catch(() => undefined);
          if (!file) continue;
          let lines: string[];
          try {
            const state = await file.stat();
            if (state.ino !== inode || state.size < offset) {
              inode = state.ino;
              offset = 0;
              pending = "";
            }
            const bytes = Buffer.alloc(Math.min(READ_LIMIT, state.size - offset));
            if (!bytes.length) continue;
            const { bytesRead } = await file.read(bytes, 0, bytes.length, offset);
            offset += bytesRead;
            changed ||= bytesRead > 0 && offset < state.size;
            lines = (pending + bytes.toString("utf8", 0, bytesRead)).split("\n");
            pending = (lines.pop() ?? "").slice(-READ_LIMIT);
          } finally {
            await file.close();
          }
          for (const line of lines) {
            if (generation !== this.generation) break;
            const match = /\bAdding process ([1-9]\d*) for gameID (\d{1,20})\s*$/.exec(line);
            if (!match) continue;
            const gameId = BigInt(match[2]);
            const appId = Number(gameId > 0xffffffffn ? gameId >> 32n : gameId);
            const launch = this.active.get(appId);
            if (launch) await this.check(launch, match[1]).catch(() => {});
          }
        }
      } finally {
        reading = false;
      }
    };
    const watcher = watch(dir, { persistent: false }, (_event, name) => {
      if (name === LOG || name === null) void drain().catch(() => {});
    });
    watcher.on("error", () => watcher.close());
    this.watchers.push(watcher);
    await drain();
  }

  private stopApp(appId: number): void {
    const launch = this.active.get(appId);
    if (launch) this.stop(launch);
  }
}

import { expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SteamLaunchLog } from "../src/wow/installation/SteamLaunchLog";

test("Steam's late process notification verifies its PID without a periodic scan", async () => {
  const home = await mkdtemp(join(tmpdir(), "wowdeck-launch-log-"));
  const logs = join(home, ".local/share/Steam/logs");
  const log = join(logs, "console-linux.txt");
  const gameId = (42n << 32n) | 0x02000000n;
  const line = (pid: number, id = gameId) => `[2026-11-18 09:00:00] Adding process ${pid} for gameID ${id}\n`;
  const calls: (string | undefined)[] = [];
  const recorded = Promise.withResolvers<void>();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const watcher = new SteamLaunchLog(home, async (launch, pid) => {
    expect(launch).toEqual({ appId: 42, accountId: 123 });
    calls.push(pid);
    if (pid !== "456") return false;
    recorded.resolve();
    return true;
  });
  try {
    await mkdir(logs, { recursive: true });
    await writeFile(log, line(123));
    await watcher.update({ appId: 42, accountId: 123 }, true);
    expect(calls).toEqual([undefined]);
    const entry = line(456);
    await appendFile(log, line(321, 43n) + entry.slice(0, -1));
    await appendFile(log, "\n");
    await Promise.race([
      recorded.promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(Error("Steam process event was missed")), 2_000);
      }),
    ]);
    expect(calls).toEqual([undefined, "456"]);
  } finally {
    clearTimeout(timeout);
    await watcher.update({ appId: 42 }, false);
    await rm(home, { recursive: true, force: true });
  }
});

/**
 * End-to-end: the engine exits once its host is gone. main.py is the only
 * writer of the engine's stdin, so stdin closing means the plugin process
 * died or was killed without stopping the engine (a Decky reload or
 * redeploy). An engine left running then shares the data folder with the
 * next one (seen on the Deck, 2026-11-25: an orphan from a previous deploy
 * still running hours later, with an open HTTPS connection).
 */

import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BIN = join(import.meta.dir, "..", "..", "out", "wowdeck-x86_64");

let root: string;
let server: ReturnType<typeof Bun.serve>;
let requestsSeen = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "wowdeck-host-gone-"));
  mkdirSync(join(root, "home"), { recursive: true });
  // A server that never answers: a request to it stays in flight, as a
  // long download or a TradeSkillMaster connection would.
  server = Bun.serve({
    port: 0,
    fetch: () => {
      requestsSeen++;
      return new Promise<Response>(() => {});
    },
  });
});

afterAll(() => {
  server.stop(true);
  rmSync(root, { recursive: true, force: true });
});

test("the engine exits soon after its stdin closes, even with a request in flight", async () => {
  const url = `http://127.0.0.1:${server.port}`;
  const engine = Bun.spawn([BIN], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: {
      ...process.env,
      HOME: join(root, "home"),
      WOWDECK_DATA_DIR: join(root, "data"),
      WOWDECK_HUB_URL: url,
      WOWDECK_RELEASES_URL: `${url}/releases/latest`,
      WOWDECK_PR_BUILDS_URL: `${url}/index.json`,
      WOWDECK_CF_URL: `${url}/v1`,
      WOWDECK_TUKUI_URL: `${url}/tukui/addons`,
      WOWDECK_ABOUT_URL: `${url}/raw`,
    },
  });
  try {
    const reader = (engine.stdout as ReadableStream<Uint8Array>).getReader();
    engine.stdin.write(`${JSON.stringify({ id: 1, method: "system.getStatus", params: {} })}\n`);
    await engine.stdin.flush();
    expect((await reader.read()).done).toBe(false); // the engine is serving
    engine.stdin.write(`${JSON.stringify({ id: 2, method: "system.updateCheck", params: {} })}\n`);
    await engine.stdin.flush();
    for (let i = 0; i < 100 && requestsSeen === 0; i++) await Bun.sleep(20);
    expect(requestsSeen).toBeGreaterThan(0); // the update check is in flight

    await engine.stdin.end(); // the host is gone

    const exited = await Promise.race([engine.exited.then(() => true), Bun.sleep(5_000).then(() => false)]);
    expect(exited).toBe(true);
  } finally {
    engine.kill(9);
  }
}, 15_000);

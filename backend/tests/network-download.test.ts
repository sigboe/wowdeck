/**
 * NetworkClient.downloadToFile's progress and abort, against a local
 * server (no network): the WoWDeck download's progress bar and its cancel
 * stand on these.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { NetworkClient } from "../src/wow/net/network";

const ROOT = "/tmp/opencode/wowdeck-tests/network-download";

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe("NetworkClient.downloadToFile", () => {
  test("reports the bytes received after every chunk, against Content-Length", async () => {
    mkdirSync(ROOT, { recursive: true });
    const body = new Uint8Array(3000).fill(7);
    const server = Bun.serve({
      port: 0,
      // A whole body, so the server sends its Content-Length as GitHub does.
      fetch: () => new Response(body),
    });
    try {
      const seen: [number, number | null][] = [];
      const path = join(ROOT, "ok.zip");
      const bytes = await new NetworkClient().downloadToFile(`http://localhost:${server.port}/z`, path, {
        onProgress: (received, total) => seen.push([received, total]),
      });

      expect(bytes).toBe(3000);
      expect(readFileSync(path).length).toBe(3000);
      expect(seen.at(-1)).toEqual([3000, 3000]);
      expect(seen.every(([, total]) => total === 3000)).toBe(true);
      const received = seen.map(([r]) => r);
      expect(received).toEqual([...received].sort((a, b) => a - b));
    } finally {
      server.stop(true);
    }
  });

  test("an abort mid-body fails at once, writes nothing and asks only once", async () => {
    mkdirSync(ROOT, { recursive: true });
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        requests++;
        // A first chunk, then the body never finishes.
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(100));
            },
          }),
        );
      },
    });
    try {
      const controller = new AbortController();
      const path = join(ROOT, "aborted.zip");
      const download = new NetworkClient().downloadToFile(`http://localhost:${server.port}/z`, path, {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      });

      await expect(download).rejects.toThrow();
      expect(existsSync(path)).toBe(false);
      expect(requests).toBe(1);
    } finally {
      server.stop(true);
    }
  });
});

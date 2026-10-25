import { describe, expect, test } from "bun:test";
import { NetworkClient } from "../src/wow/net/network";

describe("NetworkClient body timeout", () => {
  test("a response whose body stalls after the headers fails instead of hanging", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        // Headers and a first chunk, then the body never finishes.
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"data":'));
          },
        });
        return new Response(stream, { headers: { "content-type": "application/json" } });
      },
    });
    try {
      const client = new NetworkClient();
      const started = Date.now();
      await expect(
        client.getJson(`http://localhost:${server.port}/stall`, { timeoutMs: 150 }),
      ).rejects.toThrow();
      // three attempts of 150 ms plus the 0.5 s + 1 s backoff, well under a minute
      expect(Date.now() - started).toBeLessThan(5000);
    } finally {
      server.stop(true);
    }
  });

  test("a normal JSON response still parses", async () => {
    const server = Bun.serve({ port: 0, fetch: () => Response.json({ ok: 1 }) });
    try {
      expect(
        await new NetworkClient().getJson<{ ok: number }>(`http://localhost:${server.port}/`),
      ).toEqual({ ok: 1 });
    } finally {
      server.stop(true);
    }
  });
});

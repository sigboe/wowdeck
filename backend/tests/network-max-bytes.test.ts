import { describe, expect, test } from "bun:test";
import { NetworkClient, ResponseTooLargeError } from "../src/wow/net/network";

/** A local server answering `respond`, counting its requests. */
function serve(respond: () => Response) {
  let hits = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      hits += 1;
      return respond();
    },
  });
  return { url: `http://localhost:${server.port}/file`, hits: () => hits, stop: () => server.stop(true) };
}

describe("NetworkClient maxBytes", () => {
  test("a body within the cap is read as usual", async () => {
    const s = serve(() => new Response("x".repeat(100)));
    try {
      expect(await new NetworkClient().getText(s.url, { maxBytes: 100 })).toBe("x".repeat(100));
    } finally {
      s.stop();
    }
  });

  test("a Content-Length past the cap fails at once, with no retry", async () => {
    const s = serve(() => new Response("x".repeat(101)));
    try {
      await expect(new NetworkClient().getText(s.url, { maxBytes: 100 })).rejects.toBeInstanceOf(
        ResponseTooLargeError,
      );
      expect(s.hits()).toBe(1);
    } finally {
      s.stop();
    }
  });

  test("a body with no length stops being read past the cap: an endless stream still fails", async () => {
    const chunk = new TextEncoder().encode("y".repeat(1024));
    const s = serve(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(chunk);
            },
          }),
        ),
    );
    try {
      await expect(
        new NetworkClient().getText(s.url, { maxBytes: 4096, timeoutMs: 5000 }),
      ).rejects.toBeInstanceOf(ResponseTooLargeError);
      expect(s.hits()).toBe(1);
    } finally {
      s.stop();
    }
  });
});

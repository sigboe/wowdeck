import { describe, expect, test } from "bun:test";
import { NetworkClient, NetworkError, ResponseTooLargeError } from "../src/wow/net/network";

/** A local server answering `respond`, recording each request. */
function serve(respond: (req: Request) => Response | Promise<Response>) {
  const seen: { method: string; headers: Headers; body: string }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      seen.push({ method: req.method, headers: req.headers, body: await req.text() });
      return respond(req);
    },
  });
  return { url: `http://localhost:${server.port}/x`, seen, stop: () => server.stop(true) };
}

describe("NetworkClient.send", () => {
  test("hands back an error status with its body instead of throwing, without retrying when retries is 0", async () => {
    const s = serve(() => Response.json({ error: "invalid_grant" }, { status: 503 }));
    try {
      const res = await new NetworkClient().send("POST", s.url, { body: "a=b", retries: 0 });
      expect(res.ok).toBe(false);
      expect(res.status).toBe(503);
      expect(res.json<{ error: string }>().error).toBe("invalid_grant");
      expect(s.seen).toHaveLength(1);
      expect(s.seen[0]!.body).toBe("a=b");
    } finally {
      s.stop();
    }
  });

  test("returns the body bytes of a success", async () => {
    const s = serve(() => new Response(new Uint8Array([31, 139, 8])));
    try {
      const res = await new NetworkClient().send("GET", s.url, { retries: 0 });
      expect(res.ok).toBe(true);
      expect([...res.bytes]).toEqual([31, 139, 8]);
    } finally {
      s.stop();
    }
  });

  test("an oversized body fails with ResponseTooLargeError", async () => {
    const s = serve(() => new Response("x".repeat(101)));
    try {
      await expect(new NetworkClient().send("GET", s.url, { maxBytes: 100, retries: 0 })).rejects.toBeInstanceOf(
        ResponseTooLargeError,
      );
    } finally {
      s.stop();
    }
  });

  test("a body that stalls fails with a NetworkError inside the timeout", async () => {
    const s = serve(
      () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{")); } })),
    );
    try {
      await expect(new NetworkClient().send("GET", s.url, { timeoutMs: 200, retries: 0 })).rejects.toBeInstanceOf(
        NetworkError,
      );
    } finally {
      s.stop();
    }
  });

  test("redirect: error refuses a redirect", async () => {
    const s = serve(() => Response.redirect("http://localhost:1/elsewhere"));
    try {
      await expect(
        new NetworkClient().send("POST", s.url, { body: "a=b", retries: 0, redirect: "error" }),
      ).rejects.toBeInstanceOf(NetworkError);
      expect(s.seen).toHaveLength(1);
    } finally {
      s.stop();
    }
  });
});

/**
 * Diagnostics/secret redaction audit. Verifies end-to-end — through
 * the real NetworkClient, against a real local server — that neither
 * an API key sent via header nor one sent via query string ever
 * surfaces in a thrown error's .message, which is the only part of a
 * NetworkError any code in this project logs or surfaces to
 * diagnostics.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NetworkClient, NetworkError } from "../src/wow/net/network";

const SECRET = "sk-super-secret-test-key-do-not-leak-12345";

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/header-key") {
        return new Response(null, { status: 403 });
      }
      if (url.pathname === "/query-key") {
        return new Response(null, { status: 403 });
      }
      return new Response(null, { status: 404 });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe("secret redaction in network errors", () => {
  test("a key sent via header never appears in the thrown error message", async () => {
    const client = new NetworkClient();
    let caught: unknown;
    try {
      await client.getJson(`${baseUrl}/header-key`, { headers: { "X-Api-Key": SECRET } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NetworkError);
    const message = (caught as NetworkError).message;
    expect(message).not.toContain(SECRET);
  });

  test("a key sent via query string never appears in the thrown error message", async () => {
    const client = new NetworkClient();
    let caught: unknown;
    try {
      await client.getJson(`${baseUrl}/query-key`, { query: { apiKey: SECRET } });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NetworkError);
    const message = (caught as NetworkError).message;
    expect(message).not.toContain(SECRET);
  });
});

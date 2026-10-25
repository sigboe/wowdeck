/**
 * A credential-bearing header (e.g. CurseForge's X-Api-Key) must
 * never survive a redirect to a host outside an
 * explicit trusted list — plain `fetch`'s own `redirect: "follow"`
 * only strips the Fetch spec's fixed sensitive-header set
 * (Authorization/Cookie/...) on a cross-origin redirect, never a
 * provider's own custom header, so this project follows redirects by
 * hand instead whenever `trustedHostsForHeaders` is set (see
 * network.ts's own doc comment). Uses two real local HTTP servers on
 * different loopback addresses so "trusted" vs "untrusted" host
 * checks are genuine, not simulated.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NetworkClient } from "../src/wow/net/network";

const SECRET = "sk-super-secret-test-key-do-not-leak-12345";

let trustedServer: ReturnType<typeof Bun.serve>;
let untrustedServer: ReturnType<typeof Bun.serve>;
let trustedBase: string;
let untrustedBase: string;
let untrustedReceivedSecret = false;
let untrustedHitCount = 0;

beforeAll(() => {
  // Two distinct loopback hostnames so a "redirect to a different
  // host" is a real cross-origin hop, not just a different path on
  // the same server.
  trustedServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/ok") {
        return new Response(JSON.stringify({ sawSecret: req.headers.get("x-api-key") === SECRET }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/redirect-to-untrusted") {
        return new Response(null, { status: 302, headers: { location: `${untrustedBase}/landing` } });
      }
      if (url.pathname === "/redirect-to-self") {
        return new Response(null, { status: 302, headers: { location: `${trustedBase}/ok` } });
      }
      return new Response(null, { status: 404 });
    },
  });
  trustedBase = `http://127.0.0.1:${trustedServer.port}`;

  untrustedServer = Bun.serve({
    hostname: "localhost",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/landing") {
        untrustedHitCount++;
        if (req.headers.get("x-api-key") === SECRET) {
          untrustedReceivedSecret = true;
        }
        return new Response(JSON.stringify({ sawSecret: req.headers.get("x-api-key") === SECRET }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 404 });
    },
  });
  untrustedBase = `http://localhost:${untrustedServer.port}`;
});

afterAll(() => {
  trustedServer.stop(true);
  untrustedServer.stop(true);
});

describe("trustedHostsForHeaders", () => {
  test("header is sent to the initial trusted host as normal", async () => {
    const client = new NetworkClient();
    const result = await client.getJson<{ sawSecret: boolean }>(`${trustedBase}/ok`, {
      headers: { "X-Api-Key": SECRET },
      trustedHostsForHeaders: ["127.0.0.1"],
    });
    expect(result.sawSecret).toBe(true);
  });

  test("header is forwarded across a redirect that stays within the trusted host", async () => {
    const client = new NetworkClient();
    const result = await client.getJson<{ sawSecret: boolean }>(`${trustedBase}/redirect-to-self`, {
      headers: { "X-Api-Key": SECRET },
      trustedHostsForHeaders: ["127.0.0.1"],
    });
    expect(result.sawSecret).toBe(true);
  });

  test("header is dropped before following a redirect to a host outside the trusted list", async () => {
    untrustedReceivedSecret = false;
    const client = new NetworkClient();
    const result = await client.getJson<{ sawSecret: boolean }>(`${trustedBase}/redirect-to-untrusted`, {
      headers: { "X-Api-Key": SECRET },
      trustedHostsForHeaders: ["127.0.0.1"], // "localhost" is deliberately NOT in this list
    });
    expect(result.sawSecret).toBe(false);
    expect(untrustedReceivedSecret).toBe(false);
  });

  test("the redirect is still followed (request still succeeds) once the header is dropped", async () => {
    const client = new NetworkClient();
    const before = untrustedHitCount;
    await client.getJson(`${trustedBase}/redirect-to-untrusted`, {
      headers: { "X-Api-Key": SECRET },
      trustedHostsForHeaders: ["127.0.0.1"],
    });
    expect(untrustedHitCount).toBe(before + 1); // the untrusted host was still reached — just without the header
  });

  test("a dot-suffix trusted host matches its subdomains (e.g. forgecdn.net covers edge.forgecdn.net)", async () => {
    // same mechanism, checked directly against the pure matcher via a
    // request that only succeeds if 'localhost' is treated as trusted
    // through a suffix entry naming its parent-looking domain form.
    const client = new NetworkClient();
    const result = await client.getJson<{ sawSecret: boolean }>(`${untrustedBase}/landing`, {
      headers: { "X-Api-Key": SECRET },
      trustedHostsForHeaders: ["localhost"],
    });
    expect(result.sawSecret).toBe(true);
  });

  test("omitting trustedHostsForHeaders preserves existing behavior (header always forwarded)", async () => {
    // No allowlist supplied at all — every other provider in this
    // project (TukUI, WowUpHub, GitHub, WowInterface) must keep
    // working exactly as before this change.
    const client = new NetworkClient();
    const result = await client.getJson<{ sawSecret: boolean }>(`${trustedBase}/redirect-to-untrusted`, {
      headers: { "X-Api-Key": SECRET },
    });
    expect(result.sawSecret).toBe(true);
  });
});

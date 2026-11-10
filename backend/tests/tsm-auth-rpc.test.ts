import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonlServer } from "../src/bridge/jsonl";
import { register } from "../src/api/handlers/providers";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import {
  TradeSkillMasterAuth,
  TradeSkillMasterProvider,
} from "../src/wow/tsm/TradeSkillMasterAuth";
import type { HandlerDeps } from "../src/api/handlers/deps";

test("RPC starts disabled and cancellation closes the callback without enabling the source", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsm-auth-"));
  const registry = new ProviderRegistry();
  const auth = new TradeSkillMasterAuth(dir, "1.1.1", registry);
  registry.register(new TradeSkillMasterProvider(auth));
  registry.attachStore(createStateStore(dir));
  let response: any;
  const rpc = new JsonlServer((line) => {
    response = JSON.parse(line);
  });
  register(rpc, {
    registry,
    tsmAuth: auth,
    companionCoordinator: { regenerate: async () => {} },
  } as unknown as HandlerDeps);
  const call = async (method: string) => {
    await rpc.handleLine(JSON.stringify({ id: 1, method }));
    return response.result;
  };
  try {
    expect(await call("tradeskillmaster.status")).toEqual({ state: "off", account: null });
    const { authorizeUrl } = await call("tradeskillmaster.signIn");
    const url = new URL(authorizeUrl);
    expect(url.searchParams.get("client_id")).toBe("desktop-app");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(registry.usable("TradeSkillMaster")).toBeUndefined();
    expect(await call("tradeskillmaster.cancel")).toEqual({ state: "off", account: null });
    await expect(fetch(url.searchParams.get("redirect_uri")!)).rejects.toThrow();
  } finally {
    auth.cancel();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("local browser redirect exchanges PKCE, keeps only a private refresh token, and revokes on sign out", async () => {
  const { readFileSync, statSync, existsSync, writeFileSync, mkdirSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "tsm-auth-"));
  const addon = join(dir, "wow/Interface/AddOns/TradeSkillMaster");
  mkdirSync(addon, { recursive: true });
  writeFileSync(join(addon, "TradeSkillMaster.toc"), "## Version: 1\n");
  const requests: { path: string; ua: string | null; body: URLSearchParams }[] = [];
  let challenge = "";
  const tokens = await Bun.file(join(import.meta.dir, "fixtures/tsm/token.json")).json();
  const mock = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/auth") {
        challenge = url.searchParams.get("code_challenge")!;
        expect(url.searchParams.get("scope")).toBe(
          "openid roles profile email tsm-profile offline_access",
        );
        const redirect = new URL(url.searchParams.get("redirect_uri")!);
        redirect.search = new URLSearchParams({
          state: url.searchParams.get("state")!,
          code: "fixture-code",
        }).toString();
        return Response.redirect(redirect.href);
      }
      const body = new URLSearchParams(await req.text());
      requests.push({ path: url.pathname, ua: req.headers.get("User-Agent"), body });
      if (url.pathname === "/token") {
        const { createHash } = await import("node:crypto");
        expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(
          challenge,
        );
        return Response.json(tokens);
      }
      return new Response(null, { status: 204 });
    },
  });
  const base = `http://127.0.0.1:${mock.port}`;
  const registry = new ProviderRegistry();
  const callbacks = new Map<number, () => void | Promise<void>>();
  let timer = 0;
  const auth = new TradeSkillMasterAuth(
    dir,
    "1.1.1",
    registry,
    { authorize: `${base}/auth`, token: `${base}/token`, revoke: `${base}/revoke` },
    {
      setTimeout(fn, ms) {
        callbacks.set(++timer, fn);
        expect([600000, 5000, 210000]).toContain(ms);
        return timer;
      },
      clearTimeout(id) {
        callbacks.delete(id as number);
      },
    },
  );
  registry.register(new TradeSkillMasterProvider(auth));
  const store = createStateStore(dir);
  registry.attachStore(store);
  let response: any;
  const rpc = new JsonlServer((line) => {
    response = JSON.parse(line);
  });
  register(rpc, {
    registry,
    store,
    tsmAuth: auth,
    companionCoordinator: { regenerate: async () => {} },
  } as unknown as HandlerDeps);
  const call = async (method: string) => {
    await rpc.handleLine(JSON.stringify({ id: 1, method }));
    expect(response.error).toBeUndefined();
    return response.result;
  };
  try {
    const { authorizeUrl } = await call("tradeskillmaster.signIn");
    expect((await fetch(authorizeUrl)).ok).toBe(true);
    expect(await call("tradeskillmaster.status")).toEqual({
      state: "signedIn",
      account: "fixture-player",
      tier: "free",
      channels: ["release"],
    });
    expect(registry.usable("TradeSkillMaster")).toBeDefined();
    const path = join(dir, "tsm-refresh-token");
    expect(readFileSync(path, "utf8")).toBe("fixture-offline-refresh");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(store.settings)).not.toContain("fixture");
    expect(await call("tradeskillmaster.signOut")).toEqual({ state: "off", account: null });
    expect(existsSync(path)).toBe(false);
    expect(readFileSync(join(addon, "TradeSkillMaster.toc"), "utf8")).toBe("## Version: 1\n");
    expect(requests.map((r) => r.path)).toEqual(["/token", "/revoke"]);
    expect(requests.every((r) => r.ua === "WoWDeck/1.1.1")).toBe(true);
    expect(requests[1]!.body.get("token")).toBe("fixture-offline-refresh");
    const pending = await call("tradeskillmaster.signIn");
    const callback = new URL(pending.authorizeUrl).searchParams.get("redirect_uri")!;
    for (const fn of [...callbacks.values()]) fn();
    expect(await call("tradeskillmaster.status")).toEqual({ state: "off", account: null });
    await expect(fetch(callback)).rejects.toThrow();
  } finally {
    auth.cancel();
    await mock.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sign out deletes stored credentials and returns after five seconds even when revocation stalls", async () => {
  const { writeFileSync, existsSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "tsm-revoke-"));
  writeFileSync(join(dir, "tsm-refresh-token"), "stored-offline-token", { mode: 0o600 });
  let received!: () => void;
  const requestReceived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const mock = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      expect(new URLSearchParams(await req.text()).get("token")).toBe("stored-offline-token");
      received();
      return new Promise<Response>(() => {});
    },
  });
  const callbacks = new Map<number, () => void | Promise<void>>();
  let now = 0;
  const registry = new ProviderRegistry();
  const base = `http://127.0.0.1:${mock.port}`;
  const auth = new TradeSkillMasterAuth(
    dir,
    "1.1.1",
    registry,
    { authorize: `${base}/auth`, token: `${base}/token`, revoke: `${base}/revoke` },
    {
      setTimeout(fn, ms) {
        callbacks.set(now + ms, fn);
        return now + ms;
      },
      clearTimeout(id) {
        callbacks.delete(id as number);
      },
    },
  );
  registry.register(new TradeSkillMasterProvider(auth));
  const store = createStateStore(dir);
  registry.attachStore(store);
  let response: any;
  const rpc = new JsonlServer((line) => {
    response = JSON.parse(line);
  });
  register(rpc, { registry, store, tsmAuth: auth } as unknown as HandlerDeps);
  try {
    // A token file alone never enables the source or contacts TradeSkillMaster.
    registry.refreshDefaults();
    expect(registry.get("TradeSkillMaster")!.enabled).toBe(false);
    const signingOut = rpc.handleLine(
      JSON.stringify({ id: 1, method: "tradeskillmaster.signOut" }),
    );
    expect(existsSync(join(dir, "tsm-refresh-token"))).toBe(false);
    await requestReceived;
    now = 4999;
    expect(response).toBeUndefined();
    now = 5000;
    callbacks.get(now)!();
    await signingOut;
    expect(response.result).toEqual({ state: "off", account: null });
  } finally {
    auth.cancel();
    await mock.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restart restores claims, refreshes early, retries temporary failures and preserves enabled on revocation", async () => {
  const { writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "tsm-session-"));
  const tokens = await Bun.file(join(import.meta.dir, "fixtures/tsm/token.json")).json();
  tokens.access_token = `e30.${Buffer.from(JSON.stringify({ preferred_username: "fixture-player", realm_access: { roles: ["premium-gold", "channel/beta"] } })).toString("base64url")}.fixture`;
  let failure = "";
  let releaseRefresh!: (response: Response) => void;
  let refreshReceived!: () => void;
  const receivedRefresh = new Promise<void>((resolve) => { refreshReceived = resolve; });

  const requests: string[] = [];
  const mock = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const body = new URLSearchParams(await req.text());
      requests.push(body.get("grant_type")!);
      if (failure === "held" && body.get("grant_type") === "refresh_token") {
        refreshReceived();
        return new Promise<Response>((resolve) => { releaseRefresh = resolve; });
      }
      return failure
        ? Response.json({ error: failure }, { status: failure === "invalid_grant" ? 400 : 503 })
        : Response.json(tokens);
    },
  });
  const callbacks = new Map<number, () => void | Promise<void>>();
  let now = 0;
  const registry = new ProviderRegistry();
  const base = `http://127.0.0.1:${mock.port}`;
  const auth = new TradeSkillMasterAuth(
    dir,
    "1",
    registry,
    { authorize: base, token: base, revoke: base },
    {
      setTimeout(fn, ms) {
        const at = now + ms;
        callbacks.set(at, fn);
        return at;
      },
      clearTimeout(id) {
        callbacks.delete(id as number);
      },
    },
  );
  registry.register(new TradeSkillMasterProvider(auth));
  registry.attachStore(createStateStore(dir));
  registry.setEnabled("TradeSkillMaster", true);
  writeFileSync(join(dir, "tsm-refresh-token"), "fixture-offline-refresh");
  let response: any;
  const rpc = new JsonlServer((line) => {
    response = JSON.parse(line);
  });
  register(rpc, { registry, tsmAuth: auth, companionCoordinator: { regenerate: async () => {} } } as unknown as HandlerDeps);
  const status = async () => {
    await rpc.handleLine(JSON.stringify({ id: 1, method: "tradeskillmaster.status" }));
    return response.result;
  };
  // Drain the local HTTP response without elapsed-time ordering.
  const advance = async (at: number) => {
    now = at;
    const fn = callbacks.get(at)!;
    callbacks.delete(at);
    await fn();
  };
  try {
    await auth.restore();
    expect(await status()).toEqual({
      state: "signedIn",
      account: "fixture-player",
      tier: "gold",
      channels: ["release", "beta"],
    });
    expect(callbacks.has(210000)).toBe(true);
    failure = "temporarily_unavailable";
    await advance(210000);
    expect((await status()).state).toBe("signedIn");
    expect(registry.usable("TradeSkillMaster")).toBeDefined();
    failure = "invalid_grant";
    await advance(240000);
    expect((await status()).state).toBe("signedOut");
    expect(registry.get("TradeSkillMaster")!.enabled).toBe(true);
    expect(registry.usable("TradeSkillMaster")).toBeUndefined();
    expect(requests).toEqual(["refresh_token", "refresh_token", "refresh_token"]);
    failure = "";
    await rpc.handleLine(JSON.stringify({ id: 2, method: "tradeskillmaster.signIn" }));
    const authorize = new URL(response.result.authorizeUrl);
    const callback = new URL(authorize.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({ state: authorize.searchParams.get("state")!, code: "fixture-code" }).toString();
    expect((await fetch(callback)).ok).toBe(true);
    expect((await status()).state).toBe("signedIn");
    expect(registry.usable("TradeSkillMaster")).toBeDefined();
    failure = "held";
    const refreshing = advance(450000);
    await receivedRefresh;
    await rpc.handleLine(JSON.stringify({ id: 3, method: "providers.setEnabled", params: { providerId: "TradeSkillMaster", enabled: false } }));
    expect(response.error).toBeUndefined();
    expect(await status()).toEqual({ state: "off", account: "fixture-player" });
    releaseRefresh(Response.json(tokens));
    await refreshing;
    expect((await status()).state).toBe("off");
    expect(callbacks.size).toBe(0);
    const countWhileOff = requests.length;
    await auth.restore();
    expect(requests.length).toBe(countWhileOff);
    // Off remembers the account across a restart without using its token.
    expect(existsSync(join(dir, "tsm-refresh-token"))).toBe(true);
    const restarted = new TradeSkillMasterAuth(dir, "1", registry, { authorize: base, token: base, revoke: base });
    await restarted.restore();
    expect(restarted.status()).toEqual({ state: "off", account: "fixture-player" });
    expect(requests.length).toBe(countWhileOff);
    // On again continues the session without a browser sign-in.
    failure = "";
    await rpc.handleLine(JSON.stringify({ id: 4, method: "providers.setEnabled", params: { providerId: "TradeSkillMaster", enabled: true } }));
    expect(response.error).toBeUndefined();
    expect((await status()).state).toBe("signedIn");
    expect(requests.at(-1)).toBe("refresh_token");
    await rpc.handleLine(JSON.stringify({ id: 5, method: "tradeskillmaster.signOut" }));
    expect(response.result).toEqual({ state: "off", account: null });
    expect(existsSync(join(dir, "tsm-account"))).toBe(false);

  } finally {
    await mock.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

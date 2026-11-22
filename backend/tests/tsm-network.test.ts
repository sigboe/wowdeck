import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NetworkClient, ResponseTooLargeError } from "../src/wow/net/network";
import { ProviderRegistry } from "../src/wow/providers/provider-registry";
import { createStateStore } from "../src/wow/storage/StateStore";
import { InstallationService } from "../src/wow/installation/InstallationService";
import { TradeSkillMasterAuth } from "../src/wow/tsm/TradeSkillMasterAuth";
import { TradeSkillMasterData } from "../src/wow/tsm/TradeSkillMasterData";
import { TradeSkillMasterProvider } from "../src/wow/tsm/TradeSkillMasterProvider";

/** The real client, recording what it was asked and what it threw. */
class SpyNetwork extends NetworkClient {
  calls: { method: string; url: string }[] = [];
  errors: unknown[] = [];
  override async send(...args: Parameters<NetworkClient["send"]>) {
    this.calls.push({ method: args[0], url: args[1] });
    try {
      return await super.send(...args);
    } catch (error) {
      this.errors.push(error);
      throw error;
    }
  }
}

const clock = { setTimeout: () => 0, clearTimeout() {} };

test("the sign-in token request goes through the network client and a refused redirect fails the refresh", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsm-net-"));
  const seen: string[] = [];
  const mock = Bun.serve({
    port: 0,
    async fetch(req) {
      seen.push(new URL(req.url).pathname + " " + (await req.text()));
      return Response.redirect("http://127.0.0.1:1/stolen");
    },
  });
  try {
    writeFileSync(join(dir, "tsm-refresh-token"), "stored");
    const network = new SpyNetwork();
    const registry = new ProviderRegistry();
    const base = `http://localhost:${mock.port}`;
    const auth = new TradeSkillMasterAuth(dir, "1", registry, { authorize: base, token: base + "/token", revoke: base }, clock, network);
    registry.register(new TradeSkillMasterProvider(auth));
    registry.attachStore(createStateStore(dir));
    registry.get("TradeSkillMaster")!.enabled = true;
    await auth.restore();
    expect(network.calls).toEqual([{ method: "POST", url: base + "/token" }]);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("grant_type=refresh_token");
  } finally {
    mock.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an oversized catalogue answer fails with the network client's error and is not retried", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tsm-net-"));
  let hits = 0;
  const huge = new Uint8Array(17 * 1024 * 1024);
  const mock = Bun.serve({
    port: 0,
    fetch() {
      hits++;
      return new Response(huge);
    },
  });
  try {
    const network = new SpyNetwork();
    const registry = new ProviderRegistry();
    const base = `http://localhost:${mock.port}`;
    const auth = new TradeSkillMasterAuth(
      dir, "1", registry,
      { authorize: base, token: base, revoke: base, realms: base, regions: base, gameVersions: base, userRealms: base },
      clock, network,
    );
    const provider = new TradeSkillMasterProvider(auth);
    registry.register(provider);
    const store = createStateStore(dir);
    registry.attachStore(store);
    const data = new TradeSkillMasterData(auth, provider, new InstallationService(store, async () => {}), dir, () => {});
    const token = `h.${Buffer.from(JSON.stringify({ sub: "u" })).toString("base64url")}.s`;
    await (data as any).load(token, 0, false);
    expect(network.errors.length).toBeGreaterThan(0);
    expect(network.errors.every((e) => e instanceof ResponseTooLargeError)).toBe(true);
    expect(hits).toBeLessThanOrEqual(4);
  } finally {
    mock.stop(true);
    rmSync(dir, { recursive: true, force: true });
  }
});

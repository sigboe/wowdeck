import { expect, test } from "bun:test";
import { LaunchService, type LaunchEntry, type LaunchWorld } from "../src/wow/launch/LaunchService";
import type { LaunchClient, LaunchCompletion } from "../src/api/contracts";

function fixture(appId = 123) {
  let now = 0;
  let next: (() => void) | undefined;
  const asks: number[] = [];
  const results: LaunchCompletion[] = [];
  const observation = { entryRunning: true, renderer: null as number | null, gameRunning: "not_running" as const, targetRunning: null as string | null };
  const world: LaunchWorld = {
    now: () => now,
    wait: () => new Promise<void>((resolve) => { next = resolve; }),
    observe: async () => ({ ...observation }),
    ask: async () => { asks.push(now); return { startupFailed: Promise.resolve(false) }; },
  };
  const client = { kind: "wow", id: "forever", name: "Forever", shortName: "Forever" } as const;
  const entry: LaunchEntry = {
    appId,
    clients: [client],
    target: client,
    targetFolders: [{ path: "/games/wow/_forever_", shortName: "Forever" }],
    product: "WoWF",
    prefixes: ["/steam/steamapps/compatdata/123/pfx"],
    libraries: ["/steam"],
  };
  const service = new LaunchService(async () => entry, world, (result) => results.push(result), "wowdeck");
  return {
    service, observation, asks, results, world,
    async at(ms: number) {
      now = ms;
      next?.();
      for (let i = 0; i < 12; i++) await Promise.resolve();
    },
  };
}

test("a late renderer gets three asks at fifteen-second intervals inside the window, then the client counts as not started", async () => {
  const f = fixture();
  expect((await f.service.start(123)).state?.busy).toBe(true);
  await f.at(100_000);
  f.observation.renderer = 11;
  await f.at(110_000);
  await f.at(114_999);
  expect(f.asks).toEqual([]);
  await f.at(115_000);
  await f.at(130_000);
  await f.at(145_000);
  await f.at(149_999);
  expect(f.asks).toEqual([115_000, 130_000, 145_000]);
  await f.at(150_000);
  expect(f.results.map((result) => result.outcome)).toEqual(["not-started"]);
  expect((await f.service.state(123))?.busy).toBe(false);
});

test("a launcher that never draws a renderer ends with one readiness failure", async () => {
  const f = fixture();
  await f.service.start(123);
  await f.at(150_000);
  expect(f.asks).toEqual([]);
  expect(f.results.map((result) => result.outcome)).toEqual(["never-ready"]);
});

test("a duplicate press shares the attempt and stops asking when the target is seen", async () => {
  const f = fixture();
  f.observation.renderer = 11;
  await Promise.all([f.service.start(123), f.service.start(123)]);
  await f.at(15_000);
  f.observation.targetRunning = "/games/wow/_forever_";
  await f.at(16_000);
  expect(f.asks).toEqual([15_000]);
  expect(f.results.map((result) => result.outcome)).toEqual(["confirmed"]);
});

test("a failure to create the ask ends the attempt", async () => {
  const f = fixture();
  f.observation.renderer = 11;
  f.world.ask = async () => null;
  await f.service.start(123);
  await f.at(15_000);
  expect(f.results.map((result) => result.outcome)).toEqual(["ask-failed"]);
});

test("one press from rest grants Steam a single start and keeps the attempt alive until WoW appears", async () => {
  const appId = 4221385996;
  const f = fixture(appId);
  f.observation.entryRunning = false;
  expect((await f.service.start(appId))?.state?.busy).toBe(false);
  const presses = await Promise.all([f.service.start(appId, true), f.service.start(appId, true)]);
  expect(presses.every((press) => press?.state?.busy)).toBe(true);
  expect(presses.flatMap((press) => press?.steamStart ? [press.steamStart.gameId] : [])).toEqual(["18130714796645941248"]);
  await f.at(2_000);
  expect(f.asks).toEqual([]);
  f.observation.entryRunning = true;
  f.observation.renderer = 11;
  await f.at(6_000);
  await f.at(21_000);
  f.observation.targetRunning = "/games/wow/_forever_";
  await f.at(22_000);
  expect(f.asks).toEqual([21_000]);
  expect(f.results.map((result) => result.outcome)).toEqual(["confirmed"]);
});

test("a matching Steam refusal ends the attempt exactly once without sending an ask", async () => {
  const f = fixture();
  f.observation.entryRunning = false;
  const { steamStart } = await f.service.start(123, true);
  expect(steamStart).toBeDefined();
  f.service.steamRefused("another attempt");
  await f.at(1_000);
  expect(f.results).toEqual([]);
  f.service.steamRefused(steamStart!.attemptId);
  f.service.steamRefused(steamStart!.attemptId);
  f.observation.entryRunning = true; // A reaper can appear briefly before Steam reports failure.
  await f.at(2_000);
  expect(f.asks).toEqual([]);
  expect(f.results.map((result) => result.outcome)).toEqual(["steam-refused"]);
  expect((await f.service.state(123))?.busy).toBe(false);
});

test("Steam Play already starting the entry never receives a second Steam start", async () => {
  const f = fixture();
  f.observation.entryRunning = false;
  const press = await f.service.start(123, true, true);
  expect(press.steamStart).toBeUndefined();
  expect(press.state?.busy).toBe(true);
  f.observation.entryRunning = true;
  f.observation.renderer = 11;
  await f.at(5_000);
  await f.at(15_000);
  expect(f.asks).toEqual([15_000]);
});

test("a stopped entry accepted by Steam reports one readiness failure if no session appears", async () => {
  const f = fixture();
  f.observation.entryRunning = false;
  expect((await f.service.start(123, true)).steamStart).toBeDefined();
  await f.at(150_000);
  await f.at(151_000);
  expect(f.asks).toEqual([]);
  expect(f.results.map((result) => result.outcome)).toEqual(["never-ready"]);
  expect((await f.service.state(123))?.busy).toBe(false);
});

test("picking a linked target works during play and leaves a pending Steam start on its original target", async () => {
  const forever = { kind: "wow", id: "forever", name: "Forever", shortName: "Forever" } as const;
  const retail = { kind: "wow", id: "retail", name: "Retail", shortName: "Retail" } as const;
  let activeInstallation: string = forever.id;
  const f = fixture();
  let gameRunning: "running" | "not_running" = "running";
  const observedTargets: string[] = [];
  const results: LaunchCompletion[] = [];
  const service = new LaunchService(
    async (_, preferred) => {
      const clients = [forever, retail];
      const target = clients.find((client) => client.id === (preferred ?? activeInstallation)) ?? forever;
      return { appId: 123, clients, target, targetFolders: [{ path: target.id, shortName: target.shortName }], prefixes: [], libraries: [] };
    },
    {
      ...f.world,
      observe: async (entry) => {
        observedTargets.push(entry.target.id);
        return { ...f.observation, gameRunning };
      },
    },
    (result) => results.push(result),
    "wowdeck",
  );
  const save = (target: LaunchClient) => { activeInstallation = target.id; };
  await expect(service.select(123, "unlinked", save)).rejects.toThrow();
  expect(activeInstallation).toBe("forever");
  expect(await service.select(123, "retail", save)).toEqual(retail);
  expect(activeInstallation).toBe("retail");
  expect((await service.state(123))?.target).toEqual(retail);

  f.observation.entryRunning = false;
  gameRunning = "not_running";
  const started = await service.start(123, true);
  expect(started.steamStart).toBeDefined();
  expect(started.state?.target).toEqual(retail);
  await service.select(123, "forever", save);
  expect(await service.state(123)).toMatchObject({ target: forever, busy: true });

  f.observation.entryRunning = true;
  f.observation.targetRunning = "retail";
  await f.at(1_000);
  expect(observedTargets.at(-1)).toBe("retail");
  expect(results).toEqual([{ appId: 123, clientName: "Retail", outcome: "confirmed" }]);
  expect(await service.state(123)).toMatchObject({ target: forever, busy: false });
});

test("replay startup failures retry and produce one failure if none could reach Battle.net", async () => {
  const f = fixture();
  f.observation.renderer = 11;
  f.world.ask = async () => {
    f.asks.push(f.asks.length);
    return { startupFailed: Promise.resolve(true) };
  };
  await f.service.start(123);
  for (const time of [15_000, 30_000, 45_000]) await f.at(time);
  expect(f.asks).toHaveLength(3);
  expect(f.results).toEqual([]);
  await f.at(150_000);
  expect(f.results.map((result) => result.outcome)).toEqual(["ask-failed"]);
});

test.each([Promise.resolve(false), new Promise<boolean>(() => {})])(
  "a replay that may have reached Battle.net turns later startup failures into not started",
  async (startupFailed) => {
    const f = fixture();
    f.observation.renderer = 11;
    const verdicts = [Promise.resolve(true), startupFailed, Promise.resolve(true)];
    f.world.ask = async () => {
      f.asks.push(f.asks.length);
      return { startupFailed: verdicts.shift()! };
    };
    await f.service.start(123);
    for (const time of [15_000, 30_000, 45_000, 150_000]) await f.at(time);
    expect(f.asks).toHaveLength(3);
    expect(f.results.map((result) => result.outcome)).toEqual(["not-started"]);
  },
);

test("Battle.net closing after an ask leaves the outcome unconfirmed", async () => {
  const f = fixture();
  f.observation.renderer = 11;
  await f.service.start(123);
  await f.at(15_000);
  f.observation.entryRunning = false;
  await f.at(16_000);
  expect(f.results.map((result) => result.outcome)).toEqual(["unconfirmed"]);
});

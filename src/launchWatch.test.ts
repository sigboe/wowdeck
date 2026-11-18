import { expect, test } from "bun:test";
import { createManualClock } from "./testSupport/manualClock";
import { LOOK_EVERY_MS, LOOK_FOR_MS, startLaunchWatch } from "./steamDom/launchWatch";

/**
 * Steam as the watch sees it: lifetime notifications, running apps and the
 * library's shortcuts. 42 and 43 have WoW-like names; 44 and 45 do not, and
 * `linked` can name 45 as a linked or detected shortcut.
 */
function fakeSteam(
  opts: { recordedOnLook?: number; accountFails?: boolean; linked?: number[] } = {},
) {
  const clock = createManualClock();
  let notify:
    ((n: { unAppID: number; nInstanceID: number; bRunning: boolean }) => void) | undefined;
  const running = new Set<number>();
  const asks: { appId: number; accountId?: number }[] = [];
  let reloads = 0;
  let unregistered = false;
  const stop = startLaunchWatch({
    steamClient: {
      GameSessions: {
        RegisterForAppLifetimeNotifications: (cb: typeof notify) => {
          notify = cb;
          return { unregister: () => (unregistered = true) };
        },
      },
    },
    runningApps: () => [...running],
    shortcuts: () => [
      { appId: 42, name: "World of Warcraft" },
      { appId: 43, name: "Battle.net" },
      { appId: 44, name: "Unrelated game" },
      { appId: 45, name: "My games" },
    ],
    linked: () => opts.linked ?? [],
    accountId: () =>
      opts.accountFails ? Promise.reject(Error("no account")) : Promise.resolve(123),
    record: async (params) => {
      asks.push(params);
      return { recorded: opts.recordedOnLook !== undefined && asks.length >= opts.recordedOnLook };
    },
    recorded: () => reloads++,
    clock,
  });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return {
    asks,
    reloads: () => reloads,
    unregistered: () => unregistered,
    clock,
    stop,
    async start(appId: number) {
      running.add(appId);
      notify?.({ unAppID: appId, nInstanceID: 1, bRunning: true });
      await flush();
    },
    async quit(appId: number) {
      running.delete(appId);
      notify?.({ unAppID: appId, nInstanceID: 1, bRunning: false });
      await flush();
    },
    /** Move time on one look at a time, letting each look's answer arrive. */
    async advance(ms: number) {
      for (let t = 0; t < ms; t += LOOK_EVERY_MS) {
        clock.advance(Math.min(LOOK_EVERY_MS, ms - t));
        await flush();
      }
    },
  };
}

test("a shortcut start asks the engine at once, then again while it runs, until a link is recorded", async () => {
  const steam = fakeSteam({ recordedOnLook: 3 });
  await steam.start(42);
  expect(steam.asks).toEqual([{ appId: 42, accountId: 123 }]);

  await steam.advance(LOOK_EVERY_MS);
  await steam.advance(LOOK_EVERY_MS);
  expect(steam.asks).toHaveLength(3);
  expect(steam.reloads()).toBe(1);

  await steam.advance(LOOK_EVERY_MS * 5);
  expect(steam.asks).toHaveLength(3);
  expect(steam.clock.activeTimers()).toBe(0);
});

test("a Steam game's start asks nothing", async () => {
  const steam = fakeSteam();
  await steam.start(440);
  await steam.advance(LOOK_EVERY_MS * 3);
  expect(steam.asks).toEqual([]);
});

test("a shortcut that could not be WoW asks nothing", async () => {
  const steam = fakeSteam();
  await steam.start(44);
  await steam.advance(LOOK_EVERY_MS * 3);
  expect(steam.asks).toEqual([]);
  expect(steam.clock.activeTimers()).toBe(0);
});

test("a shortcut linked or detected already is watched whatever its name", async () => {
  const steam = fakeSteam({ linked: [45] });
  await steam.start(45);
  await steam.advance(LOOK_EVERY_MS);
  expect(steam.asks).toEqual([
    { appId: 45, accountId: 123 },
    { appId: 45, accountId: 123 },
  ]);
});

test("looking stops when the shortcut quits", async () => {
  const steam = fakeSteam();
  await steam.start(43);
  await steam.quit(43);
  await steam.advance(LOOK_EVERY_MS * 3);
  expect(steam.asks).toHaveLength(1);
  expect(steam.clock.activeTimers()).toBe(0);
  expect(steam.reloads()).toBe(0);
});

test("looking stops after a while even when the shortcut keeps running", async () => {
  const steam = fakeSteam();
  await steam.start(42);
  await steam.advance(LOOK_FOR_MS + LOOK_EVERY_MS * 3);
  expect(steam.asks).toHaveLength(1 + LOOK_FOR_MS / LOOK_EVERY_MS);
  expect(steam.clock.activeTimers()).toBe(0);
});

test("an unknown Steam account still asks, for any account's shortcut", async () => {
  const steam = fakeSteam({ accountFails: true });
  await steam.start(42);
  expect(steam.asks).toEqual([{ appId: 42 }]);
});

test("stopping the watch unregisters and ends any look in progress", async () => {
  const steam = fakeSteam();
  await steam.start(42);
  steam.stop();
  await steam.advance(LOOK_EVERY_MS * 3);
  expect(steam.asks).toHaveLength(1);
  expect(steam.unregistered()).toBe(true);
});

test("without Steam's lifetime notifications the watch does nothing and never throws", () => {
  const stop = startLaunchWatch({
    steamClient: undefined,
    runningApps: () => null,
    shortcuts: () => [],
    linked: () => [],
    accountId: () => Promise.resolve(123),
    record: async () => ({ recorded: false }),
    recorded: () => {},
    clock: createManualClock(),
  });
  expect(() => stop()).not.toThrow();
});

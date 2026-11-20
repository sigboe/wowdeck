import { expect, test } from "bun:test";
import { startLaunchWatch } from "./steamDom/launchWatch";

function fakeSteam(accountId = async () => 123) {
  type Notification = { unAppID: number; bRunning: boolean };
  let notify: (notification: Notification) => void;
  const calls: Array<{ appId: number; accountId?: number; running: boolean }> = [];
  let unregistered = false;
  const stop = startLaunchWatch({
    steamClient: {
      GameSessions: {
        RegisterForAppLifetimeNotifications(cb: typeof notify) {
          notify = cb;
          return {
            unregister: () => {
              unregistered = true;
            },
          };
        },
      },
    },
    shortcuts: () => [
      { appId: 42, name: "Battle.net" },
      { appId: 43, name: "Unrelated game" },
      { appId: 44, name: "My games" },
    ],
    linked: () => [44],
    accountId,
    watch: async (params) => {
      calls.push(params);
    },
  });
  return {
    calls,
    stop,
    unregistered: () => unregistered,
    async notify(appId: number, running: boolean) {
      notify({ unAppID: appId, bRunning: running });
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test("Steam starts and stops one engine watch for each eligible shortcut", async () => {
  const steam = fakeSteam();
  await steam.notify(42, true);
  await steam.notify(42, true);
  await steam.notify(43, true);
  await steam.notify(440, true);
  await steam.notify(44, true);
  await steam.notify(42, false);
  expect(steam.calls).toEqual([
    { appId: 42, accountId: 123, running: true },
    { appId: 44, accountId: 123, running: true },
    { appId: 42, running: false },
  ]);
  steam.stop();
  expect(steam.calls[steam.calls.length - 1]).toEqual({ appId: 44, running: false });
  expect(steam.unregistered()).toBe(true);
});

test("a quit while resolving the account cancels the pending start", async () => {
  const account = Promise.withResolvers<number>();
  const steam = fakeSteam(() => account.promise);
  await steam.notify(42, true);
  await steam.notify(42, false);
  account.resolve(123);
  await Promise.resolve();
  await Promise.resolve();
  expect(steam.calls).toEqual([]);
  steam.stop();
});

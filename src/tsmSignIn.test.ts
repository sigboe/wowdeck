import { createTsmModule } from "./tsmReads";
import { createManualClock } from "./testSupport/manualClock";
import { test, expect, afterEach } from "bun:test";
import { startTsmSignIn, stopTsmSignIn } from "./tsmSignIn";
import { createFakeEngine } from "./testSupport/fakeEngine";
import type { TradeSkillMasterAuthStatus } from "../backend/src/api/contracts";

function harness(states: TradeSkillMasterAuthStatus["state"][]) {
  const opened: string[] = [];
  let closed = 0;
  const { rpc } = createFakeEngine({
    "tradeskillmaster.signIn": { authorizeUrl: "https://fixture.invalid/authorize" },
    "tradeskillmaster.status": () => ({ state: states.shift()!, account: null }),
  });
  const browser = { open: (url: string) => opened.push(url), close: () => closed++ };
  const clock = createManualClock();
  const module = createTsmModule({ rpc, clock, reloadSources: async () => {} });
  const step = async () => {
    clock.advance(1000);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  return {
    rpc,
    browser,
    status: module.status,
    opened,
    closed: () => closed,
    step,
    watching: () => clock.activeTimers() > 0,
  };
}

test("sign-in opens the authorize URL and closes the browser once signed in", async () => {
  const h = harness(["signingIn", "signedIn"]);
  await startTsmSignIn(h.rpc, h.browser, h.status);
  expect(h.opened).toEqual(["https://fixture.invalid/authorize"]);
  await h.step();
  expect(h.closed()).toBe(0);
  await h.step();
  expect(h.closed()).toBe(1);
  expect(h.watching()).toBe(false);
});

test("a cancelled sign-in leaves the browser alone", async () => {
  const h = harness(["off"]);
  await startTsmSignIn(h.rpc, h.browser, h.status);
  await h.step();
  expect(h.closed()).toBe(0);
  expect(h.watching()).toBe(false);
});

test("sign-in keeps the shared poll alive after its panel leaves", async () => {
  const clock = createManualClock();
  let state: TradeSkillMasterAuthStatus["state"] = "signingIn";
  const fake = createFakeEngine({
    "tradeskillmaster.signIn": { authorizeUrl: "https://fixture.invalid/authorize" },
    "tradeskillmaster.status": () => ({ state, account: null }),
  });
  const module = createTsmModule({ rpc: fake.rpc, clock, reloadSources: async () => {} });
  const panel = module.status.subscribe("account", () => {});
  let closed = 0;
  await startTsmSignIn(fake.rpc, { open: () => {}, close: () => closed++ }, module.status);
  expect(clock.activeTimers()).toBe(1);
  panel();
  state = "signedIn";
  clock.advance(1000);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(closed).toBe(1);
  expect(module.status.get("account").data?.state).toBe("signedIn");
  expect(clock.activeTimers()).toBe(0);
});

test("sign-in supersedes a stalled pre-login read and cancellation ignores its late answer", async () => {
  const fake = createFakeEngine({
    "tradeskillmaster.signIn": { authorizeUrl: "https://fixture.invalid/authorize" },
    "tradeskillmaster.cancel": { state: "off", account: null },
  });
  const clock = createManualClock();
  const module = createTsmModule({ rpc: fake.rpc, clock, reloadSources: async () => {} });
  const off = module.status.subscribe("account", () => {});
  const oldRead = fake.next("tradeskillmaster.status");
  let closed = 0;
  await startTsmSignIn(
    fake.rpc,
    {
      open() {},
      close() {
        closed++;
      },
    },
    module.status,
  );
  off();
  clock.advance(1000);
  expect(fake.pending("tradeskillmaster.status")).toHaveLength(2);
  const poll = fake.pending("tradeskillmaster.status")[1]!;
  await poll.resolve({ state: "signedIn", account: "fixture-player" });
  expect(module.status.get("account").data?.state).toBe("signedIn");
  expect(closed).toBe(1);
  expect(clock.activeTimers()).toBe(0);
  await oldRead.resolve({ state: "off", account: null });
  expect(module.status.get("account").data?.state).toBe("signedIn");
  expect(module.status.get("account").loading).toBe(false);

  delete fake.answers["tradeskillmaster.status"];
  await startTsmSignIn(fake.rpc, { open() {}, close() {} }, module.status);
  const cancelledRead = fake.next("tradeskillmaster.status");
  await module.cancel();
  expect(fake.paramsOf("tradeskillmaster.cancel")).toHaveLength(1);
  expect(module.status.get("account").data?.state).toBe("off");
  expect(module.status.get("account").loading).toBe(false);
  expect(clock.activeTimers()).toBe(0);
  await cancelledRead.resolve({ state: "signingIn", account: null });
  expect(module.status.get("account").data?.state).toBe("off");
});

const originalWindow = globalThis.window;
afterEach(() => {
  globalThis.window = originalWindow;
});
for (const state of ["signedIn", "off", "signedOut"] as const) {
  test(`sign-in dismisses the keyboard when polling finishes with ${state}`, async () => {
    let hidden = 0;
    globalThis.window = {
      SteamUIStore: {
        ActiveWindowInstance: {
          VirtualKeyboardManager: {
            IsShowingVirtualKeyboard: { Value: true },
            SetVirtualKeyboardHidden: () => hidden++,
          },
        },
      },
    } as unknown as Window & typeof globalThis;
    const h = harness(["signingIn", state]);
    await startTsmSignIn(h.rpc, h.browser, h.status);
    await h.step();
    expect(hidden).toBe(0);
    await h.step();
    expect(hidden).toBe(1);
    expect(h.watching()).toBe(false);
  });
}

test("plugin teardown dismisses the keyboard and releases sign-in polling", async () => {
  let hidden = 0;
  globalThis.window = {
    SteamUIStore: {
      ActiveWindowInstance: {
        VirtualKeyboardManager: {
          SetVirtualKeyboardHidden: () => hidden++,
        },
      },
    },
  } as unknown as Window & typeof globalThis;
  const h = harness(["signedIn"]);
  await startTsmSignIn(h.rpc, h.browser, h.status);
  stopTsmSignIn();
  expect(hidden).toBe(1);
  expect(h.watching()).toBe(false);
  await h.step();
  expect(h.closed()).toBe(0);
});

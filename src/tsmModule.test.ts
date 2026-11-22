import { expect, test } from "bun:test";
import { createTsmModule } from "./tsmReads";
import { createFakeEngine } from "./testSupport/fakeEngine";
import { createManualClock } from "./testSupport/manualClock";

test("all sign-in viewers share polling and a change refreshes status and sources", async () => {
  let state: "signedIn" | "signedOut" = "signedIn";
  const fake = createFakeEngine({
    "tradeskillmaster.status": () => ({ state, account: null }),
  });
  const clock = createManualClock();
  let reloads = 0;
  const module = createTsmModule({
    rpc: fake.rpc,
    clock,
    reloadSources: async () => {
      reloads++;
    },
  });
  const off = module.status.subscribe("account", () => {});
  const off2 = module.status.subscribe("account", () => {});
  await module.status.refresh("account");
  expect(clock.activeTimers()).toBe(1);
  state = "signedOut";
  module.changed();
  await new Promise<void>((resolve) => {
    const off = module.status.subscribe("account", () => {
      if (module.status.get("account").data?.state === "signedOut") {
        off();
        resolve();
      }
    });
  });
  expect(module.status.get("account").data?.state).toBe("signedOut");
  expect(reloads).toBeGreaterThan(0);
  off();
  off2();
  expect(clock.activeTimers()).toBe(0);
});

test("installed TSM addons use installation keys and refresh after addon changes", async () => {
  const fake = createFakeEngine({ "addons.list": { addons: [], unverified: true } });
  const module = createTsmModule({
    rpc: fake.rpc,
    clock: createManualClock(),
    reloadSources: async () => {},
  });
  const off = module.addons.subscribe("retail", () => {});
  await module.addons.refresh("retail");
  expect(module.addons.get("retail").data?.unverified).toBe(true);
  expect(module.addons.get("classic").data).toBeNull();
  fake.answers["addons.list"] = { addons: [] };
  module.addonsChanged();
  await import("./testSupport/fakeEngine").then((m) => m.settle());
  expect(module.addons.get("retail").data?.unverified).toBeUndefined();
  off();
});

test("cancel publishes signed-out state to every viewer without waiting for an obsolete read", async () => {
  const fake = createFakeEngine({
    "tradeskillmaster.cancel": { state: "off", account: null },
  });
  const clock = createManualClock();
  let reloads = 0;
  const module = createTsmModule({
    rpc: fake.rpc,
    clock,
    reloadSources: async () => {
      reloads++;
    },
  });
  const views: string[][] = [[], [], []];
  const leave = views.map((states) =>
    module.status.subscribe("account", () => {
      const state = module.status.get("account").data?.state;
      if (state) states.push(state);
    }),
  );
  const obsolete = fake.next("tradeskillmaster.status");
  module.status.put("account", { state: "signingIn", account: null });
  await module.cancel();
  expect(fake.paramsOf("tradeskillmaster.cancel")).toHaveLength(1);
  expect(module.status.get("account")).toEqual({
    data: { state: "off", account: null },
    error: null,
    loading: false,
  });
  for (const states of views) expect(states[states.length - 1]).toBe("off");
  expect(reloads).toBeGreaterThan(0);
  leave.forEach((off) => off());
  expect(clock.activeTimers()).toBe(0);
  await obsolete.resolve({ state: "signingIn", account: null });
  expect(module.status.get("account").data?.state).toBe("off");
});

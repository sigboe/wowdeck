import { createTsmModule } from "./tsmReads";
import { createManualClock } from "./testSupport/manualClock";
import { test, expect } from "bun:test";
import { tsmActionRequired, tsmOptionsSources, tsmDestinationVisible } from "./tsmSession";
import { createFakeEngine } from "./testSupport/fakeEngine";
import type { TradeSkillMasterAuthStatus } from "../backend/src/api/contracts";
import { BROWSE_TABS } from "./browseSessionState";
import { BROWSE_BAR_ITEMS } from "./sourceAccess";
import { startSourceJump, sourceJump, clearSourceJump } from "./optionsJump";

test("RPC signed-out transitions notify once, clear on sign-in, and jump to the source", async () => {
  let state: TradeSkillMasterAuthStatus["state"] = "signedOut";
  let notifications = 0;
  const fake = createFakeEngine({ "tradeskillmaster.status": () => ({ state, account: null }) });
  const module = createTsmModule({
    rpc: fake.rpc,
    clock: createManualClock(),
    reloadSources: async () => {},
    sessionEnded: () => notifications++,
  });
  const tsmSession = { get: () => module.status.get("account").data! };
  const read = () => module.status.refresh("account");
  await read();
  await read();
  expect(notifications).toBe(1);
  expect(tsmActionRequired(tsmSession.get())).toBe(true);
  state = "signedIn";
  await read();
  expect(tsmActionRequired(tsmSession.get())).toBe(false);
  state = "signedOut";
  await read();
  expect(notifications).toBe(2);
  expect(tsmDestinationVisible([{ id: "TradeSkillMaster", enabled: true }])).toBe(true);
  expect(tsmDestinationVisible([{ id: "TradeSkillMaster", enabled: false }])).toBe(false);
  expect(BROWSE_TABS.slice(-2)).toEqual(["controllerLayouts", "tsm"]);
  expect(BROWSE_BAR_ITEMS.tsm).toEqual([]);
  startSourceJump(tsmOptionsSources(), [
    {
      id: "TradeSkillMaster",
      allowEdit: true,
      enabled: true,
      configured: false,
    } as import("./types").ProviderInfo,
  ]);
  expect(sourceJump()?.marked.has("TradeSkillMaster")).toBe(true);
  expect(sourceJump()?.landingKey).toBe("provider:TradeSkillMaster");
  clearSourceJump();
});
